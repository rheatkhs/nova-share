import { hashBuffer } from "./hash.ts";
import type { BatchFileHeaderItem, BatchManifestHeader } from "./types.ts";

export interface BatchInputFile {
  relativePath: string;
  mtime: number;
  data: Uint8Array;
}

export interface EncodedBatchPacket {
  manifest: BatchManifestHeader;
  binaryFrame: Uint8Array;
}

export interface DecodedBatchPacket {
  manifest: BatchManifestHeader;
  payload: Uint8Array;
}

/**
 * Binary Frame Format for Micro-Batching:
 * - Bytes 0..3: UInt32BE length of JSON Manifest Header (N bytes)
 * - Bytes 4..(4+N-1): UTF-8 JSON string of `BatchManifestHeader`
 * - Bytes (4+N)..end: Concatenated raw file bytes
 */
export function encodeBatchPacket(
  destinationDir: string,
  files: BatchInputFile[]
): EncodedBatchPacket {
  let totalPayloadBytes = 0;
  for (const f of files) {
    totalPayloadBytes += f.data.byteLength;
  }

  const payload = new Uint8Array(totalPayloadBytes);
  const headerItems: BatchFileHeaderItem[] = [];

  let offset = 0;
  for (const f of files) {
    payload.set(f.data, offset);
    headerItems.push({
      relativePath: f.relativePath,
      size: f.data.byteLength,
      mtime: f.mtime,
      offset,
      hash: hashBuffer(f.data),
    });
    offset += f.data.byteLength;
  }

  const payloadHash = hashBuffer(payload);
  const manifest: BatchManifestHeader = {
    destinationDir,
    files: headerItems,
    payloadHash,
  };

  const headerBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const frame = new Uint8Array(4 + headerBytes.byteLength + payload.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, headerBytes.byteLength, false); // Big-Endian
  frame.set(headerBytes, 4);
  frame.set(payload, 4 + headerBytes.byteLength);

  return {
    manifest,
    binaryFrame: frame,
  };
}

/**
 * Decodes a Micro-Batch binary frame back into manifest + payload slice.
 */
export function decodeBatchPacket(frameBuffer: ArrayBuffer | Uint8Array): DecodedBatchPacket {
  const bytes =
    frameBuffer instanceof Uint8Array ? frameBuffer : new Uint8Array(frameBuffer);

  if (bytes.byteLength < 4) {
    throw new Error("Invalid batch frame: buffer shorter than 4 bytes");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, false);

  if (headerLength <= 0 || 4 + headerLength > bytes.byteLength) {
    throw new Error(`Invalid batch header length: ${headerLength}`);
  }

  const headerSlice = bytes.subarray(4, 4 + headerLength);
  const manifestJson = new TextDecoder().decode(headerSlice);
  const manifest = JSON.parse(manifestJson) as BatchManifestHeader;
  const payload = bytes.subarray(4 + headerLength);

  return {
    manifest,
    payload,
  };
}
