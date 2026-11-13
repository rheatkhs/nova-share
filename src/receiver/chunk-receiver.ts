import * as fs from "node:fs/promises";
import * as path from "node:path";
import { hashBuffer, safeCompareHex } from "../shared/hash.ts";
import { resolveSafeChildPath, toPosixRelative } from "../shared/path-utils.ts";
import type { ChunkMetaFile } from "../shared/types.ts";

export interface ReceiveChunkParams {
  destinationDir: string;
  relativePath: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  offset: number;
  totalSize: number;
  sourceMtime: number;
  expectedHash: string;
  data: Uint8Array;
}

export interface CompleteChunkFileParams {
  destinationDir: string;
  relativePath: string;
  totalSize: number;
  sourceMtime: number;
}

interface ActivePartSession {
  handle: fs.FileHandle;
  meta: ChunkMetaFile;
  completedSet: Set<number>;
}

const activeSessions = new Map<string, ActivePartSession>();
const fileLocks = new Map<string, Promise<void>>();

async function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(key) ?? Promise.resolve();
  const { promise: next, resolve: release } = Promise.withResolvers<void>();
  fileLocks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (fileLocks.get(key) === next) {
      fileLocks.delete(key);
    }
  }
}

async function getOrCreateSession(
  partFile: string,
  metaFile: string,
  targetFile: string,
  relPath: string,
  params: ReceiveChunkParams
): Promise<ActivePartSession> {
  const existing = activeSessions.get(partFile);
  if (
    existing &&
    existing.meta.totalSize === params.totalSize &&
    existing.meta.chunkSize === params.chunkSize
  ) {
    return existing;
  }

  return withFileLock(`init:${partFile}`, async () => {
    const doubleCheck = activeSessions.get(partFile);
    if (
      doubleCheck &&
      doubleCheck.meta.totalSize === params.totalSize &&
      doubleCheck.meta.chunkSize === params.chunkSize
    ) {
      return doubleCheck;
    }

    if (doubleCheck) {
      await doubleCheck.handle.close().catch(() => {});
      activeSessions.delete(partFile);
    }

    await fs.mkdir(path.dirname(targetFile), { recursive: true });

    let handle: fs.FileHandle;
    try {
      handle = await fs.open(partFile, "r+");
    } catch {
      handle = await fs.open(partFile, "w+");
    }

    let meta: ChunkMetaFile;
    try {
      const raw = await fs.readFile(metaFile, "utf8");
      const parsed = JSON.parse(raw) as ChunkMetaFile;
      if (parsed.totalSize === params.totalSize && parsed.chunkSize === params.chunkSize) {
        meta = parsed;
      } else {
        meta = {
          relativePath: relPath,
          totalSize: params.totalSize,
          sourceMtime: params.sourceMtime,
          chunkSize: params.chunkSize,
          totalChunks: params.totalChunks,
          completedChunks: [],
        };
      }
    } catch {
      meta = {
        relativePath: relPath,
        totalSize: params.totalSize,
        sourceMtime: params.sourceMtime,
        chunkSize: params.chunkSize,
        totalChunks: params.totalChunks,
        completedChunks: [],
      };
    }

    const session: ActivePartSession = {
      handle,
      meta,
      completedSet: new Set(meta.completedChunks),
    };
    activeSessions.set(partFile, session);
    return session;
  });
}

/**
 * Verifies a single 8MB chunk's SHA-256 hash, writes it concurrently at the exact byte offset
 * inside the cached `<filename>.novapart` descriptor, and updates `<filename>.novapart.meta.json`.
 */
export async function receiveFileChunk(params: ReceiveChunkParams): Promise<{
  chunkIndex: number;
  completedCount: number;
  totalChunks: number;
}> {
  const actualHash = hashBuffer(params.data);
  if (!safeCompareHex(actualHash, params.expectedHash)) {
    throw new Error(
      `HASH_MISMATCH: Chunk ${params.chunkIndex} of "${params.relativePath}" corrupted in transit (expected ${params.expectedHash}, got ${actualHash})`
    );
  }

  const relPath = toPosixRelative(params.relativePath);
  const targetFile = resolveSafeChildPath(params.destinationDir, relPath);
  const partFile = `${targetFile}.novapart`;
  const metaFile = `${targetFile}.novapart.meta.json`;

  const session = await getOrCreateSession(partFile, metaFile, targetFile, relPath, params);

  // Concurrent positional write (pwrite) without blocking other non-overlapping chunks
  await session.handle.write(params.data, 0, params.data.byteLength, params.offset);

  // Synchronize metadata update & flush
  return withFileLock(`meta:${partFile}`, async () => {
    if (!session.completedSet.has(params.chunkIndex)) {
      session.completedSet.add(params.chunkIndex);
      session.meta.completedChunks.push(params.chunkIndex);
    }

    // Flush .meta.json every 4 chunks or on the final chunk to reduce disk IOPS overhead
    if (
      session.completedSet.size === session.meta.totalChunks ||
      session.completedSet.size % 4 === 0 ||
      session.completedSet.size === 1
    ) {
      await fs.writeFile(metaFile, JSON.stringify(session.meta), "utf8");
    }

    return {
      chunkIndex: params.chunkIndex,
      completedCount: session.completedSet.size,
      totalChunks: session.meta.totalChunks,
    };
  });
}

/**
 * Finalizes a chunked transfer:
 * 1. Closes cached FileHandle and flushes metadata
 * 2. Verifies all chunks were received and `.novapart` size equals `totalSize`
 * 3. Atomically renames `<file>.novapart` -> `<file>`
 * 4. Preserves original `mtime` and deletes `.novapart.meta.json`
 */
export async function completeChunkedFile(params: CompleteChunkFileParams): Promise<{
  relativePath: string;
  size: number;
}> {
  const relPath = toPosixRelative(params.relativePath);
  const targetFile = resolveSafeChildPath(params.destinationDir, relPath);
  const partFile = `${targetFile}.novapart`;
  const metaFile = `${targetFile}.novapart.meta.json`;

  return withFileLock(`init:${partFile}`, async () => {
    const session = activeSessions.get(partFile);
    if (session) {
      if (session.completedSet.size < session.meta.totalChunks) {
        throw new Error(
          `MISSING_CHUNKS: "${relPath}" only has ${session.completedSet.size}/${session.meta.totalChunks} chunks completed`
        );
      }
      await session.handle.close().catch(() => {});
      activeSessions.delete(partFile);
    } else {
      try {
        const rawMeta = await fs.readFile(metaFile, "utf8");
        const meta = JSON.parse(rawMeta) as ChunkMetaFile;
        if (meta.completedChunks.length < meta.totalChunks) {
          throw new Error(
            `MISSING_CHUNKS: "${relPath}" only has ${meta.completedChunks.length}/${meta.totalChunks} chunks completed`
          );
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("MISSING_CHUNKS:")) {
          throw err;
        }
      }
    }

    const stat = await fs.stat(partFile);
    if (stat.size !== params.totalSize) {
      throw new Error(
        `INCOMPLETE_FILE: "${relPath}" .novapart size (${stat.size}) does not match expected totalSize (${params.totalSize})`
      );
    }

    await fs.rename(partFile, targetFile);

    const mtimeDate = new Date(params.sourceMtime);
    await fs.utimes(targetFile, mtimeDate, mtimeDate).catch(() => {});
    await fs.unlink(metaFile).catch(() => {});

    return {
      relativePath: relPath,
      size: params.totalSize,
    };
  });
}
