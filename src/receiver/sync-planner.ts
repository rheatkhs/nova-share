import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_CHUNK_SIZE } from "../shared/constants.ts";
import { resolveSafeChildPath, toPosixRelative } from "../shared/path-utils.ts";
import type {
  ChunkMetaFile,
  SyncPlanItem,
  SyncPlanRequest,
  SyncPlanResponse,
} from "../shared/types.ts";
import { getDiskSpace } from "./fs-browser.ts";

/**
 * Compares incoming sender file metadata against the receiver's destination directory:
 * - SKIP: destination file exists with matching size and mtime (within 2 seconds tolerance for cross-FS precision)
 * - RESUME: `.novapart` and `.novapart.meta.json` exist for the same size & chunkSize
 * - NEW: file does not exist or has changed
 */
export async function createSyncPlan(req: SyncPlanRequest): Promise<SyncPlanResponse> {
  const destRoot = path.resolve(req.destinationDir);
  await fs.mkdir(destRoot, { recursive: true });

  const chunkSize = req.chunkSize || DEFAULT_CHUNK_SIZE;
  const plan: SyncPlanItem[] = [];

  let skipCount = 0;
  let resumeCount = 0;
  let newCount = 0;
  let bytesToTransfer = 0;
  let bytesSkipped = 0;

  for (const entry of req.files) {
    const relPath = toPosixRelative(entry.relativePath);
    const targetFile = resolveSafeChildPath(destRoot, relPath);
    const partFile = `${targetFile}.novapart`;
    const metaFile = `${targetFile}.novapart.meta.json`;

    // 1. Check if partial transfer (.novapart + .meta.json) exists for RESUME
    let resumed = false;
    try {
      const [partStat, metaRaw] = await Promise.all([
        fs.stat(partFile),
        fs.readFile(metaFile, "utf8"),
      ]);
      if (partStat.isFile()) {
        const meta = JSON.parse(metaRaw) as ChunkMetaFile;
        if (
          meta.totalSize === entry.size &&
          meta.chunkSize === chunkSize &&
          Array.isArray(meta.completedChunks)
        ) {
          const uniqueCompleted = Array.from(new Set(meta.completedChunks)).sort(
            (a, b) => a - b
          );
          let completedBytes = 0;
          const totalChunks = Math.ceil(entry.size / chunkSize);
          for (const idx of uniqueCompleted) {
            if (idx === totalChunks - 1) {
              const rem = entry.size % chunkSize;
              completedBytes += rem === 0 ? chunkSize : rem;
            } else if (idx >= 0 && idx < totalChunks) {
              completedBytes += chunkSize;
            }
          }
          const remaining = Math.max(0, entry.size - completedBytes);
          plan.push({
            relativePath: relPath,
            size: entry.size,
            mtime: entry.mtime,
            action: "RESUME",
            completedChunks: uniqueCompleted,
            chunkSize,
          });
          resumeCount++;
          bytesToTransfer += remaining;
          bytesSkipped += completedBytes;
          resumed = true;
        }
      }
    } catch {
      // No valid .novapart state found
    }

    if (resumed) continue;

    // 2. Check if final file already exists and matches size + mtime
    try {
      const existingStat = await fs.stat(targetFile);
      const mtimeDiff = Math.abs(Math.floor(existingStat.mtimeMs) - Math.floor(entry.mtime));
      // Allow up to 2000ms tolerance for cross-OS filesystem timestamp granularity
      if (existingStat.isFile() && existingStat.size === entry.size && mtimeDiff <= 2000) {
        plan.push({
          relativePath: relPath,
          size: entry.size,
          mtime: entry.mtime,
          action: "SKIP",
        });
        skipCount++;
        bytesSkipped += entry.size;
        continue;
      }
    } catch {
      // File does not exist yet
    }

    // 3. Otherwise mark as NEW
    plan.push({
      relativePath: relPath,
      size: entry.size,
      mtime: entry.mtime,
      action: "NEW",
      chunkSize: entry.size >= chunkSize ? chunkSize : undefined,
    });
    newCount++;
    bytesToTransfer += entry.size;
  }

  const { freeBytes, totalBytes } = await getDiskSpace(destRoot);

  return {
    destinationDir: destRoot,
    freeBytes,
    totalBytes,
    plan,
    summary: {
      totalFiles: req.files.length,
      skipCount,
      resumeCount,
      newCount,
      bytesToTransfer,
      bytesSkipped,
    },
  };
}
