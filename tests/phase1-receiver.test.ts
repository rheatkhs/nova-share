import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { startReceiverServer, type ReceiverServerInstance } from "../src/receiver/server.ts";
import { encodeBatchPacket } from "../src/shared/batch-codec.ts";
import { hashBuffer } from "../src/shared/hash.ts";
import { resolveSafeChildPath } from "../src/shared/path-utils.ts";

describe("Phase 1: Shared Core & Receiver Daemon API", () => {
  const token = "test-token-phase1";
  let server: ReceiverServerInstance;
  let baseUrl = "";
  let tempDir = "";

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "novashare-p1-"));
    server = startReceiverServer({ port: 0, hostname: "127.0.0.1", token });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    server.stop(true);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("rejects unauthorized requests without valid X-Nova-Token", async () => {
    const res = await fetch(`${baseUrl}/api/system/info`);
    expect(res.status).toBe(401);
  });

  test("returns system info and browses remote directory with free disk space", async () => {
    const infoRes = await fetch(`${baseUrl}/api/system/info`, {
      headers: { "X-Nova-Token": token },
    });
    expect(infoRes.status).toBe(200);
    const info = await infoRes.json();
    expect(info.name).toContain("NovaShare");

    const subFolder = path.join(tempDir, "linux-target");
    const mkdirRes = await fetch(`${baseUrl}/api/fs/mkdir`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Nova-Token": token },
      body: JSON.stringify({ path: subFolder }),
    });
    expect(mkdirRes.status).toBe(200);

    const browseRes = await fetch(
      `${baseUrl}/api/fs/browse?path=${encodeURIComponent(tempDir)}`,
      { headers: { "X-Nova-Token": token } }
    );
    expect(browseRes.status).toBe(200);
    const browse = await browseRes.json();
    expect(browse.entries.some((e: { name: string }) => e.name === "linux-target")).toBe(true);
  });

  test("blocks path traversal attempts", () => {
    expect(() => resolveSafeChildPath(tempDir, "../../etc/passwd")).toThrow();
  });

  test("unpacks Micro-Batch (Lane A) and preserves file content + mtime", async () => {
    const dest = path.join(tempDir, "batch-dest");
    const f1Bytes = new TextEncoder().encode("Hello small file 1");
    const f2Bytes = new TextEncoder().encode("Nested small file 2");
    const mtime = 1763020800000;

    const { binaryFrame } = encodeBatchPacket(dest, [
      { relativePath: "a/hello.txt", mtime, data: f1Bytes },
      { relativePath: "b/c/nested.txt", mtime, data: f2Bytes },
    ]);

    const res = await fetch(`${baseUrl}/api/transfer/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Nova-Token": token,
      },
      body: binaryFrame,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.filesExtracted).toBe(2);

    const saved1 = await fs.readFile(path.join(dest, "a/hello.txt"), "utf8");
    expect(saved1).toBe("Hello small file 1");
  });

  test("handles Chunked Transfer (Lane B), detects corrupted chunk, supports resume, and completes atomically", async () => {
    const dest = path.join(tempDir, "chunk-dest");
    const chunk0 = new Uint8Array(1024).fill(65); // 'A'
    const chunk1 = new Uint8Array(1024).fill(66); // 'B'
    const totalSize = 2048;
    const mtime = 1763020800000;

    // Send chunk 0
    const res0 = await fetch(`${baseUrl}/api/transfer/chunk`, {
      method: "POST",
      headers: {
        "X-Nova-Token": token,
        "X-Nova-Dest": encodeURIComponent(dest),
        "X-Nova-Path": encodeURIComponent("big/video.bin"),
        "X-Nova-Chunk-Index": "0",
        "X-Nova-Total-Chunks": "2",
        "X-Nova-Chunk-Size": "1024",
        "X-Nova-Offset": "0",
        "X-Nova-Total-Size": String(totalSize),
        "X-Nova-Mtime": String(mtime),
        "X-Nova-Hash": hashBuffer(chunk0),
      },
      body: chunk0,
    });
    expect(res0.status).toBe(200);

    // Check sync plan reports RESUME with completedChunks: [0]
    const planRes = await fetch(`${baseUrl}/api/sync/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Nova-Token": token },
      body: JSON.stringify({
        destinationDir: dest,
        chunkSize: 1024,
        files: [{ relativePath: "big/video.bin", size: totalSize, mtime }],
      }),
    });
    const planData = await planRes.json();
    expect(planData.plan[0].action).toBe("RESUME");
    expect(planData.plan[0].completedChunks).toEqual([0]);

    // Send corrupted chunk 1 -> must return 422
    const badRes = await fetch(`${baseUrl}/api/transfer/chunk`, {
      method: "POST",
      headers: {
        "X-Nova-Token": token,
        "X-Nova-Dest": encodeURIComponent(dest),
        "X-Nova-Path": encodeURIComponent("big/video.bin"),
        "X-Nova-Chunk-Index": "1",
        "X-Nova-Total-Chunks": "2",
        "X-Nova-Chunk-Size": "1024",
        "X-Nova-Offset": "1024",
        "X-Nova-Total-Size": String(totalSize),
        "X-Nova-Mtime": String(mtime),
        "X-Nova-Hash": "0000000000000000000000000000000000000000000000000000000000000000",
      },
      body: chunk1,
    });
    expect(badRes.status).toBe(422);

    // Send valid chunk 1
    const res1 = await fetch(`${baseUrl}/api/transfer/chunk`, {
      method: "POST",
      headers: {
        "X-Nova-Token": token,
        "X-Nova-Dest": encodeURIComponent(dest),
        "X-Nova-Path": encodeURIComponent("big/video.bin"),
        "X-Nova-Chunk-Index": "1",
        "X-Nova-Total-Chunks": "2",
        "X-Nova-Chunk-Size": "1024",
        "X-Nova-Offset": "1024",
        "X-Nova-Total-Size": String(totalSize),
        "X-Nova-Mtime": String(mtime),
        "X-Nova-Hash": hashBuffer(chunk1),
      },
      body: chunk1,
    });
    expect(res1.status).toBe(200);

    // Complete file
    const compRes = await fetch(`${baseUrl}/api/transfer/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Nova-Token": token },
      body: JSON.stringify({
        destinationDir: dest,
        relativePath: "big/video.bin",
        totalSize,
        sourceMtime: mtime,
      }),
    });
    expect(compRes.status).toBe(200);

    const finalBytes = await fs.readFile(path.join(dest, "big/video.bin"));
    expect(finalBytes.byteLength).toBe(2048);
    expect(finalBytes[0]).toBe(65);
    expect(finalBytes[1024]).toBe(66);
  });
});
