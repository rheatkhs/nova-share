import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { startReceiverServer, type ReceiverServerInstance } from "../src/receiver/server.ts";
import { TransferManager } from "../src/sender/transfer-manager.ts";
import { hashBuffer } from "../src/shared/hash.ts";

describe("Phase 2: Windows Sender Engine (Dual-Lane Pipeline & Delta Sync)", () => {
  const token = "test-token-phase2";
  let receiver: ReceiverServerInstance;
  let receiverUrl = "";
  let tempRoot = "";
  let sourceDir = "";
  let destDir = "";

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "novashare-p2-"));
    sourceDir = path.join(tempRoot, "win-source");
    destDir = path.join(tempRoot, "linux-dest");

    await fs.mkdir(path.join(sourceDir, "docs"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, "images"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, "node_modules/pkg"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, "vm"), { recursive: true });

    // Create 15 small files (< 64KB) + 1 ignored file in node_modules
    for (let i = 1; i <= 15; i++) {
      await fs.writeFile(
        path.join(sourceDir, "docs", `note-${i}.txt`),
        `Small file content #${i} - NovaShare Micro-Batch test`
      );
    }
    await fs.writeFile(
      path.join(sourceDir, "node_modules/pkg/index.js"),
      "console.log('should be ignored');"
    );

    // Create a large file that exceeds our test chunkSize (64 KB * 4.5 = ~288 KB)
    const largeBytes = new Uint8Array(290 * 1024);
    for (let i = 0; i < largeBytes.length; i++) {
      largeBytes[i] = i % 251;
    }
    await fs.writeFile(path.join(sourceDir, "vm/disk-image.bin"), largeBytes);

    receiver = startReceiverServer({ port: 0, hostname: "127.0.0.1", token });
    receiverUrl = `http://127.0.0.1:${receiver.port}`;
  });

  afterAll(async () => {
    receiver.stop(true);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test("transfers small files via Lane A (Micro-Batch) and large files via Lane B (Chunk Stream), ignoring node_modules", async () => {
    const manager = new TransferManager();
    const finalProgress = await manager.runBackupJob({
      sourceDir,
      destinationDir: destDir,
      receiverUrl,
      token,
      useSmartIgnore: true,
      chunkSize: 64 * 1024, // 64 KB chunks for fast multi-chunk test
      concurrency: 2,
    });

    expect(finalProgress.state).toBe("COMPLETED");
    expect(finalProgress.totalFiles).toBe(16); // 15 small + 1 large (node_modules ignored)
    expect(finalProgress.filesCompleted).toBe(16);
    expect(finalProgress.filesSkipped).toBe(0);

    // Verify node_modules was not transferred
    const nmExists = await fs
      .stat(path.join(destDir, "node_modules"))
      .then(() => true)
      .catch(() => false);
    expect(nmExists).toBe(false);

    // Verify large file hash is 100% identical
    const srcLarge = new Uint8Array(await fs.readFile(path.join(sourceDir, "vm/disk-image.bin")));
    const dstLarge = new Uint8Array(await fs.readFile(path.join(destDir, "vm/disk-image.bin")));
    expect(hashBuffer(dstLarge)).toBe(hashBuffer(srcLarge));
  });

  test("skips all unchanged files on second backup run (Delta Sync)", async () => {
    const manager = new TransferManager();
    const secondRun = await manager.runBackupJob({
      sourceDir,
      destinationDir: destDir,
      receiverUrl,
      token,
      useSmartIgnore: true,
      chunkSize: 64 * 1024,
    });

    expect(secondRun.state).toBe("COMPLETED");
    expect(secondRun.filesSkipped).toBe(16);
    expect(secondRun.filesCompleted).toBe(0);
    expect(secondRun.bytesTransferred).toBe(0);
  });

  test("transfers only explicitly selected files when selectedItems is provided", async () => {
    const selectiveDest = path.join(tempRoot, "selective-dest");
    const manager = new TransferManager();
    const result = await manager.runBackupJob({
      sourceDir: path.join(sourceDir, "docs"),
      selectedItems: ["note-1.txt", "note-2.txt"],
      destinationDir: selectiveDest,
      receiverUrl,
      token,
      useSmartIgnore: true,
    });

    expect(result.state).toBe("COMPLETED");
    expect(result.totalFiles).toBe(2);
    expect(result.filesCompleted).toBe(2);

    const f1Exists = await fs
      .stat(path.join(selectiveDest, "note-1.txt"))
      .then(() => true)
      .catch(() => false);
    const f3Exists = await fs
      .stat(path.join(selectiveDest, "note-3.txt"))
      .then(() => true)
      .catch(() => false);
    expect(f1Exists).toBe(true);
    expect(f3Exists).toBe(false);
  });
});
