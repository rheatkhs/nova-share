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

// Per-file mutex lock to avoid race conditions when parallel workers write chunks to the same file
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

/**
 * Verifies a single 8MB chunk's SHA-256 hash, writes it at the exact byte offset
 * inside `<filename>.novapart`, and updates `<filename>.novapart.meta.json`.
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

  return withFileLock(partFile, async () => {
    await fs.mkdir(path.dirname(targetFile), { recursive: true });

    // Open existing .novapart or create it without truncating existing chunks
    let handle: fs.FileHandle;
    try {
      handle = await fs.open(partFile, "r+");
    } catch {
      handle = await fs.open(partFile, "w+");
    }

    try {
      await handle.write(params.data, 0, params.data.byteLength, params.offset);
    } finally {
      await handle.close();
    }

    // Load or initialize chunk metadata state
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

    if (!meta.completedChunks.includes(params.chunkIndex)) {
      meta.completedChunks.push(params.chunkIndex);
    }

    await fs.writeFile(metaFile, JSON.stringify(meta), "utf8");

    return {
      chunkIndex: params.chunkIndex,
      completedCount: meta.completedChunks.length,
      totalChunks: meta.totalChunks,
    };
  });
}

/**
 * Finalizes a chunked transfer:
 * 1. Verifies all chunks were received and `.novapart` size equals `totalSize`
 * 2. Atomically renames `<file>.novapart` -> `<file>`
 * 3. Preserves original `mtime` and deletes `.novapart.meta.json`
 */
export async function completeChunkedFile(params: CompleteChunkFileParams): Promise<{
  relativePath: string;
  size: number;
}> {
  const relPath = toPosixRelative(params.relativePath);
  const targetFile = resolveSafeChildPath(params.destinationDir, relPath);
  const partFile = `${targetFile}.novapart`;
  const metaFile = `${targetFile}.novapart.meta.json`;

  return withFileLock(partFile, async () => {
    const stat = await fs.stat(partFile);
    if (stat.size !== params.totalSize) {
      throw new Error(
        `INCOMPLETE_FILE: "${relPath}" .novapart size (${stat.size}) does not match expected totalSize (${params.totalSize})`
      );
    }

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

    // Atomic rename .novapart -> targetFile
    await fs.rename(partFile, targetFile);

    // Apply original modification time
    const mtimeDate = new Date(params.sourceMtime);
    await fs.utimes(targetFile, mtimeDate, mtimeDate).catch(() => {});

    // Remove temporary meta file
    await fs.unlink(metaFile).catch(() => {});

    return {
      relativePath: relPath,
      size: params.totalSize,
    };
  });
}
