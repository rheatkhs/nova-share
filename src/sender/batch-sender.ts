import * as fs from "node:fs/promises";
import * as path from "node:path";
import { encodeBatchPacket, type BatchInputFile } from "../shared/batch-codec.ts";
import { MAX_BATCH_BYTES, MAX_BATCH_FILES } from "../shared/constants.ts";
import type { SyncPlanItem } from "../shared/types.ts";

export interface SendBatchGroupsOptions {
  sourceDir: string;
  destinationDir: string;
  receiverUrl: string;
  token: string;
  items: SyncPlanItem[];
  waitIfPausedOrOffline: () => Promise<void>;
  throttleBytes: (bytes: number) => Promise<void>;
  onBatchProgress: (filesDone: number, bytesDone: number, currentFile: string) => void;
  onNetworkDrop: (errMessage: string) => Promise<void>;
}

/**
 * Lane A (Micro-Batching):
 * Groups hundreds of small files (< 8 MB) in RAM up to 8 MB / 200 files per request,
 * sends them in a single binary HTTP request, and automatically retries on Wi-Fi drop.
 */
export async function sendSmallFileBatches(options: SendBatchGroupsOptions): Promise<void> {
  const { sourceDir, destinationDir, receiverUrl, token, items } = options;
  if (items.length === 0) return;

  // Group items into batches bounded by MAX_BATCH_BYTES and MAX_BATCH_FILES
  const batches: SyncPlanItem[][] = [];
  let currentBatch: SyncPlanItem[] = [];
  let currentBatchBytes = 0;

  for (const item of items) {
    if (
      currentBatch.length >= MAX_BATCH_FILES ||
      (currentBatch.length > 0 && currentBatchBytes + item.size > MAX_BATCH_BYTES)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchBytes = 0;
    }
    currentBatch.push(item);
    currentBatchBytes += item.size;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  const endpoint = `${receiverUrl.replace(/\/+$/, "")}/api/transfer/batch`;

  let cursor = 0;
  const workerCount = Math.min(3, batches.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= batches.length) break;
      const batch = batches[idx]!;

      await options.waitIfPausedOrOffline();

      const batchInputs: BatchInputFile[] = await Promise.all(
        batch.map(async (item) => {
          const fullPath = path.resolve(sourceDir, item.relativePath);
          const data = new Uint8Array(await fs.readFile(fullPath));
          return {
            relativePath: item.relativePath,
            mtime: item.mtime,
            data,
          };
        })
      );

      let batchRawBytes = 0;
      for (const b of batchInputs) {
        batchRawBytes += b.data.byteLength;
      }

      const { binaryFrame } = encodeBatchPacket(destinationDir, batchInputs);
      const label =
        batch.length === 1
          ? batch[0]!.relativePath
          : `${batch[0]!.relativePath} (+${batch.length - 1} small files)`;

      while (true) {
        await options.waitIfPausedOrOffline();
        try {
          await options.throttleBytes(binaryFrame.byteLength);
          const res = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Nova-Token": token,
            },
            body: binaryFrame,
          });

          if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Batch HTTP ${res.status}: ${errText}`);
          }

          options.onBatchProgress(batch.length, batchRawBytes, label);
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await options.onNetworkDrop(msg);
        }
      }
    }
  });

  await Promise.all(workers);
}
