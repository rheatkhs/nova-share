import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_CHUNK_SIZE } from "../shared/constants.ts";
import { hashBuffer } from "../shared/hash.ts";
import type { SyncPlanItem } from "../shared/types.ts";

export interface SendChunkedFileOptions {
  sourceDir: string;
  destinationDir: string;
  receiverUrl: string;
  token: string;
  item: SyncPlanItem;
  concurrency?: number;
  waitIfPausedOrOffline: () => Promise<void>;
  throttleBytes: (bytes: number) => Promise<void>;
  onChunkSent: (
    bytesSent: number,
    chunkIndex: number,
    totalChunks: number,
    relativePath: string
  ) => void;
  onFileCompleted: (relativePath: string) => void;
  onNetworkDrop: (errMessage: string) => Promise<void>;
}

/**
 * Lane B (Chunked Streaming for Large Files >= 8 MB up to hundreds of GB):
 * Reads 8 MB blocks directly by byte offset without loading the whole file into RAM,
 * hashes each chunk with SHA-256, skips already completed chunks (RESUME),
 * uploads missing chunks in parallel worker lanes, and triggers atomic completion.
 */
export async function sendLargeFileChunked(options: SendChunkedFileOptions): Promise<void> {
  const { sourceDir, destinationDir, receiverUrl, token, item } = options;
  const fullPath = path.resolve(sourceDir, item.relativePath);
  const chunkSize = item.chunkSize || DEFAULT_CHUNK_SIZE;
  const totalChunks = Math.max(1, Math.ceil(item.size / chunkSize));
  const completedSet = new Set<number>(item.completedChunks || []);

  const pendingIndices: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!completedSet.has(i)) {
      pendingIndices.push(i);
    }
  }

  const baseUrl = receiverUrl.replace(/\/+$/, "");
  const chunkEndpoint = `${baseUrl}/api/transfer/chunk`;
  const completeEndpoint = `${baseUrl}/api/transfer/complete`;

  const handle = await fs.open(fullPath, "r");
  let sentChunksCount = completedSet.size;

  try {
    const workerCount = Math.max(1, Math.min(options.concurrency || 4, 16, pendingIndices.length || 1));
    let queueCursor = 0;

    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const myIndex = queueCursor++;
        if (myIndex >= pendingIndices.length) break;
        const chunkIndex = pendingIndices[myIndex]!;

        await options.waitIfPausedOrOffline();

        const offset = chunkIndex * chunkSize;
        const expectedLength = Math.min(chunkSize, Math.max(0, item.size - offset));
        const buffer = new Uint8Array(expectedLength);

        const { bytesRead } = await handle.read(buffer, 0, expectedLength, offset);
        const chunkSlice = bytesRead === expectedLength ? buffer : buffer.subarray(0, bytesRead);
        const chunkHash = hashBuffer(chunkSlice);

        // Retry loop per 8 MB chunk so a dropped Wi-Fi connection only retries this 8 MB chunk
        while (true) {
          await options.waitIfPausedOrOffline();
          try {
            await options.throttleBytes(chunkSlice.byteLength);
            const res = await fetch(chunkEndpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/octet-stream",
                "X-Nova-Token": token,
                "X-Nova-Dest": encodeURIComponent(destinationDir),
                "X-Nova-Path": encodeURIComponent(item.relativePath),
                "X-Nova-Chunk-Index": String(chunkIndex),
                "X-Nova-Total-Chunks": String(totalChunks),
                "X-Nova-Chunk-Size": String(chunkSize),
                "X-Nova-Offset": String(offset),
                "X-Nova-Total-Size": String(item.size),
                "X-Nova-Mtime": String(item.mtime),
                "X-Nova-Hash": chunkHash,
              },
              body: chunkSlice,
            });

            if (!res.ok) {
              const errText = await res.text();
              throw new Error(`Chunk ${chunkIndex} HTTP ${res.status}: ${errText}`);
            }

            sentChunksCount++;
            options.onChunkSent(
              chunkSlice.byteLength,
              sentChunksCount,
              totalChunks,
              item.relativePath
            );
            break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await options.onNetworkDrop(msg);
          }
        }
      }
    });

    await Promise.all(workers);
  } finally {
    await handle.close();
  }

  // Finalize file (.novapart -> native filename + mtime)
  while (true) {
    await options.waitIfPausedOrOffline();
    try {
      const compRes = await fetch(completeEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Nova-Token": token,
        },
        body: JSON.stringify({
          destinationDir,
          relativePath: item.relativePath,
          totalSize: item.size,
          sourceMtime: item.mtime,
        }),
      });

      if (!compRes.ok) {
        const errText = await compRes.text();
        throw new Error(`Finalize HTTP ${compRes.status}: ${errText}`);
      }

      options.onFileCompleted(item.relativePath);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await options.onNetworkDrop(msg);
    }
  }
}
