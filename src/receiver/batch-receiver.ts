import * as fs from "node:fs/promises";
import * as path from "node:path";
import { decodeBatchPacket } from "../shared/batch-codec.ts";
import { hashBuffer, safeCompareHex } from "../shared/hash.ts";
import { resolveSafeChildPath, toPosixRelative } from "../shared/path-utils.ts";

/**
 * Unpacks a Micro-Batch binary frame containing up to hundreds of small files (< 8 MB),
 * verifies both the overall payload hash and individual file hashes, writes each file
 * atomically to its native path on the Receiver, and preserves `mtime`.
 */
export async function receiveMicroBatch(frameBuffer: ArrayBuffer | Uint8Array): Promise<{
  filesExtracted: number;
  bytesWritten: number;
}> {
  const { manifest, payload } = decodeBatchPacket(frameBuffer);

  // Verify aggregate payload hash
  const actualPayloadHash = hashBuffer(payload);
  if (!safeCompareHex(actualPayloadHash, manifest.payloadHash)) {
    throw new Error(
      `BATCH_HASH_MISMATCH: Batch payload corrupted in transit (expected ${manifest.payloadHash}, got ${actualPayloadHash})`
    );
  }

  const destRoot = path.resolve(manifest.destinationDir);
  await fs.mkdir(destRoot, { recursive: true });

  let bytesWritten = 0;

  for (const item of manifest.files) {
    const relPath = toPosixRelative(item.relativePath);
    const targetFile = resolveSafeChildPath(destRoot, relPath);

    if (item.offset < 0 || item.offset + item.size > payload.byteLength) {
      throw new Error(`Invalid batch slice bounds for file "${relPath}"`);
    }

    const fileBytes = payload.subarray(item.offset, item.offset + item.size);
    const fileHash = hashBuffer(fileBytes);
    if (!safeCompareHex(fileHash, item.hash)) {
      throw new Error(`FILE_HASH_MISMATCH: File "${relPath}" inside batch failed hash check`);
    }

    await fs.mkdir(path.dirname(targetFile), { recursive: true });

    const tempPath = `${targetFile}.novapart`;
    await fs.writeFile(tempPath, fileBytes);
    await fs.rename(tempPath, targetFile);

    const mtimeDate = new Date(item.mtime);
    await fs.utimes(targetFile, mtimeDate, mtimeDate).catch(() => {});

    bytesWritten += item.size;
  }

  return {
    filesExtracted: manifest.files.length,
    bytesWritten,
  };
}
