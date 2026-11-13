import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  DEFAULT_CHUNK_SIZE,
  SMALL_FILE_THRESHOLD,
} from "../shared/constants.ts";
import type {
  DryRunPreviewResponse,
  SyncPlanItem,
  SyncPlanResponse,
  TransferProgress,
} from "../shared/types.ts";
import { sendSmallFileBatches } from "./batch-sender.ts";
import { sendLargeFileChunked } from "./chunk-sender.ts";
import { appendTransferHistory } from "./config-store.ts";
import { inspectRouteQuality } from "./discovery.ts";
import { scanSourceDirectory } from "./scanner.ts";

export interface StartTransferJobParams {
  sourceDir: string;
  selectedItems?: string[];
  destinationDir: string;
  receiverUrl: string;
  token: string;
  useSmartIgnore?: boolean;
  customIgnore?: string[];
  bandwidthLimitMBps?: number;
  concurrency?: number;
  chunkSize?: number;
}

type ProgressListener = (progress: TransferProgress) => void;

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export class TransferManager {
  private progress: TransferProgress = {
    state: "IDLE",
    jobId: null,
    sourceDir: "",
    destinationDir: "",
    receiverUrl: "",
    startedAt: null,
    updatedAt: Date.now(),
    totalFiles: 0,
    filesCompleted: 0,
    filesSkipped: 0,
    filesRemaining: 0,
    totalBytes: 0,
    bytesTransferred: 0,
    bytesSkipped: 0,
    speedBytesPerSec: 0,
    etaSeconds: null,
    currentFile: null,
    currentLane: null,
    currentChunkInfo: null,
    errorMessage: null,
    recentLogs: [
      "[SYSTEM] Dual-Lane Engine siap (Jalur A: Micro-Batch <8MB | Jalur B: Chunk Stream 8MB + SHA-256).",
      "[SYSTEM] Pilih folder SENDER & tujuan RECEIVER, lalu klik Mulai Backup.",
    ],
  };

  private listeners = new Set<ProgressListener>();
  private pauseGate: { promise: Promise<void>; resolve: () => void } | null = null;
  private cancelRequested = false;
  private bandwidthLimitMBps = 0;
  private activeStartedAt = 0;
  private activeSessionBytes = 0;

  public getProgress(): TransferProgress {
    return {
      ...this.progress,
      recentLogs: [...this.progress.recentLogs],
    };
  }

  public subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    listener(this.getProgress());
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setBandwidthLimit(mbps: number): void {
    this.bandwidthLimitMBps = Math.max(0, mbps);
    this.log(`Bandwidth limit updated: ${this.bandwidthLimitMBps > 0 ? `${this.bandwidthLimitMBps} MB/s` : "Unlimited"}`);
    this.emit();
  }

  public pause(): void {
    if (this.progress.state === "TRANSFERRING" || this.progress.state === "WAITING_FOR_NETWORK") {
      this.pauseGate = Promise.withResolvers<void>();
      this.progress.state = "PAUSED";
      this.log("Transfer paused by user.");
      this.emit();
    }
  }

  public resume(): void {
    if (this.progress.state === "PAUSED" && this.pauseGate) {
      const gate = this.pauseGate;
      this.pauseGate = null;
      this.progress.state = "TRANSFERRING";
      this.log("Transfer resumed.");
      this.emit();
      gate.resolve();
    }
  }

  public cancel(): void {
    this.cancelRequested = true;
    if (this.pauseGate) {
      this.pauseGate.resolve();
      this.pauseGate = null;
    }
    this.progress.state = "CANCELLED";
    this.log("Transfer cancelled by user.");
    this.emit();
  }

  private log(msg: string): void {
    const time = new Date().toISOString().slice(11, 19);
    this.progress.recentLogs.push(`[${time}] ${msg}`);
    if (this.progress.recentLogs.length > 60) {
      this.progress.recentLogs.shift();
    }
  }

  private emit(): void {
    this.progress.updatedAt = Date.now();
    const elapsedSec = Math.max(0.2, (Date.now() - this.activeStartedAt) / 1000);
    if (this.progress.state === "TRANSFERRING" && this.activeSessionBytes > 0) {
      this.progress.speedBytesPerSec = Math.round(this.activeSessionBytes / elapsedSec);
      const remainingBytes = Math.max(
        0,
        this.progress.totalBytes - this.progress.bytesTransferred - this.progress.bytesSkipped
      );
      this.progress.etaSeconds =
        this.progress.speedBytesPerSec > 0
          ? Math.ceil(remainingBytes / this.progress.speedBytesPerSec)
          : null;
    } else if (this.progress.state !== "TRANSFERRING") {
      this.progress.speedBytesPerSec = 0;
      this.progress.etaSeconds = null;
    }

    const snapshot = this.getProgress();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private async waitIfPausedOrOffline(): Promise<void> {
    if (this.cancelRequested) {
      throw new Error("TRANSFER_CANCELLED");
    }
    if (this.pauseGate) {
      await this.pauseGate.promise;
    }
    if (this.cancelRequested) {
      throw new Error("TRANSFER_CANCELLED");
    }
  }

  private async throttleBytes(bytes: number): Promise<void> {
    if (this.bandwidthLimitMBps <= 0) return;
    const maxBytesPerSec = this.bandwidthLimitMBps * 1024 * 1024;
    const expectedMs = Math.round((bytes / maxBytesPerSec) * 1000);
    if (expectedMs > 5) {
      await sleep(expectedMs);
    }
  }

  private async waitForReceiverRecovery(
    receiverUrl: string,
    token: string,
    errMessage: string
  ): Promise<void> {
    if (this.cancelRequested) {
      throw new Error("TRANSFER_CANCELLED");
    }
    // If the error is a permanent configuration/auth/validation error, throw immediately
    if (errMessage.includes("HTTP 401") || errMessage.includes("HTTP 400")) {
      throw new Error(errMessage);
    }

    this.progress.state = "WAITING_FOR_NETWORK";
    this.progress.errorMessage = errMessage;
    this.log(`Connection interrupted (${errMessage}). Waiting for Wi-Fi / Tailscale to recover...`);
    this.emit();

    const healthUrl = `${receiverUrl.replace(/\/+$/, "")}/api/system/info`;

    while (!this.cancelRequested) {
      await sleep(2000);
      if (this.pauseGate) {
        await this.pauseGate.promise;
      }
      try {
        const res = await fetch(healthUrl, {
          headers: { "X-Nova-Token": token },
        });
        if (res.ok) {
          this.progress.state = "TRANSFERRING";
          this.progress.errorMessage = null;
          this.log("Connection to Linux Receiver restored! Auto-resuming from last chunk...");
          this.emit();
          return;
        }
      } catch {
        // Still offline, keep polling
      }
    }
  }

  /**
   * Starts a full backup job asynchronously and returns the jobId immediately
   * (or can be awaited in tests via `runBackupJob`).
   */
  public async runBackupJob(params: StartTransferJobParams): Promise<TransferProgress> {
    if (
      this.progress.state === "SCANNING" ||
      this.progress.state === "PLANNING" ||
      this.progress.state === "TRANSFERRING"
    ) {
      throw new Error("A backup job is already running.");
    }

    this.cancelRequested = false;
    this.pauseGate = null;
    this.bandwidthLimitMBps = params.bandwidthLimitMBps ?? 0;
    this.activeStartedAt = Date.now();
    this.activeSessionBytes = 0;

    const jobId = `job-${Date.now()}`;
    const chunkSize = params.chunkSize || DEFAULT_CHUNK_SIZE;
    const smallThreshold = Math.min(SMALL_FILE_THRESHOLD, chunkSize);

    this.progress = {
      state: "SCANNING",
      jobId,
      sourceDir: params.sourceDir,
      destinationDir: params.destinationDir,
      receiverUrl: params.receiverUrl,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      totalFiles: 0,
      filesCompleted: 0,
      filesSkipped: 0,
      filesRemaining: 0,
      totalBytes: 0,
      bytesTransferred: 0,
      bytesSkipped: 0,
      speedBytesPerSec: 0,
      etaSeconds: null,
      currentFile: null,
      currentLane: null,
      currentChunkInfo: null,
      errorMessage: null,
      recentLogs: [],
    };
    this.log(`Scanning source folder: ${params.sourceDir}`);
    this.emit();

    try {
      // Determine if sourceDir is a single file or a directory
      const resolvedSource = path.resolve(params.sourceDir);
      const sourceStat = await fs.stat(resolvedSource);
      const effectiveSourceDir = sourceStat.isFile()
        ? path.dirname(resolvedSource)
        : resolvedSource;

      // Smart Dual-Route check: automatically switch to Direct LAN if reachable, or fallback to Tailscale if LAN is offline
      let activeReceiverUrl = params.receiverUrl.trim().replace(/\/+$/, "");
      try {
        const routeInfo = await inspectRouteQuality(activeReceiverUrl);
        if (routeInfo.fasterUrlAvailable) {
          this.log(
            `[SMART-ROUTE] Otomatis beralih ke jalur optimal: ${routeInfo.fasterUrlAvailable}`
          );
          activeReceiverUrl = routeInfo.fasterUrlAvailable;
          this.progress.receiverUrl = activeReceiverUrl;
          this.emit();
        }
      } catch {
        // Keep user-supplied URL
      }
      // 1. Scan source directory or selected files
      const scannedFiles = await scanSourceDirectory({
        sourceDir: resolvedSource,
        selectedItems: params.selectedItems,
        useSmartIgnore: params.useSmartIgnore,
        customIgnore: params.customIgnore,
        shouldAbort: () => this.cancelRequested,
        onProgress: (count, currentRel) => {
          if (count % 50 === 0) {
            this.progress.currentFile = currentRel;
            this.emit();
          }
        },
      });
      const totalSourceBytes = scannedFiles.reduce((acc, f) => acc + f.size, 0);
      this.progress.totalFiles = scannedFiles.length;
      this.progress.totalBytes = totalSourceBytes;
      this.progress.state = "PLANNING";
      this.log(
        `Scanned ${scannedFiles.length} files (${(totalSourceBytes / (1024 * 1024)).toFixed(2)} MB). Requesting Delta Sync plan from Linux Receiver...`
      );
      this.emit();

      // 2. Request Sync Plan from Receiver
      const planUrl = `${activeReceiverUrl}/api/sync/plan`;
      const planRes = await fetch(planUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Nova-Token": params.token,
        },
        body: JSON.stringify({
          destinationDir: params.destinationDir,
          files: scannedFiles,
          chunkSize,
        }),
      });

      if (!planRes.ok) {
        const errBody = await planRes.text();
        throw new Error(`Sync Plan failed (${planRes.status}): ${errBody}`);
      }

      const syncPlan = (await planRes.json()) as SyncPlanResponse;
      this.progress.filesSkipped = syncPlan.summary.skipCount;
      this.progress.bytesSkipped = syncPlan.summary.bytesSkipped;
      this.progress.filesRemaining =
        syncPlan.summary.newCount + syncPlan.summary.resumeCount;

      this.log(
        `Sync Plan ready: ${syncPlan.summary.skipCount} skipped (up-to-date), ${syncPlan.summary.resumeCount} resuming from .novapart, ${syncPlan.summary.newCount} new.`
      );

      // Partition into Lane A (Micro-Batch < threshold) and Lane B (Chunked >= threshold or RESUME)
      const smallItems: SyncPlanItem[] = [];
      const largeItems: SyncPlanItem[] = [];

      for (const item of syncPlan.plan) {
        if (item.action === "SKIP") continue;
        if (item.action === "RESUME" || item.size >= smallThreshold) {
          largeItems.push({ ...item, chunkSize });
        } else {
          smallItems.push(item);
        }
      }

      this.progress.state = "TRANSFERRING";
      this.activeStartedAt = Date.now();
      this.emit();

      // 3. Execute Lane A: Micro-Batching for small files
      if (smallItems.length > 0) {
        this.progress.currentLane = "BATCH";
        this.progress.currentChunkInfo = `Micro-Batching (${smallItems.length} small files)`;
        this.log(`Starting Lane A (Micro-Batching) for ${smallItems.length} small files...`);
        this.emit();

        await sendSmallFileBatches({
          sourceDir: effectiveSourceDir,
          destinationDir: params.destinationDir,
          receiverUrl: activeReceiverUrl,
          token: params.token,
          items: smallItems,
          waitIfPausedOrOffline: () => this.waitIfPausedOrOffline(),
          throttleBytes: (b) => this.throttleBytes(b),
          onBatchProgress: (filesDone, bytesDone, label) => {
            this.progress.filesCompleted += filesDone;
            this.progress.filesRemaining = Math.max(0, this.progress.filesRemaining - filesDone);
            this.progress.bytesTransferred += bytesDone;
            this.activeSessionBytes += bytesDone;
            this.progress.currentFile = label;
            this.emit();
          },
          onNetworkDrop: (errMsg) =>
            this.waitForReceiverRecovery(activeReceiverUrl, params.token, errMsg),
        });
      }

      // 4. Execute Lane B: 8MB Chunked Streaming for large / resumed files
      if (largeItems.length > 0) {
        this.progress.currentLane = "CHUNK";
        this.log(`Starting Lane B (Chunk Streaming) for ${largeItems.length} large/resumed files...`);
        this.emit();

        for (const item of largeItems) {
          this.progress.currentFile = item.relativePath;
          const totalChunks = Math.max(1, Math.ceil(item.size / chunkSize));
          const initialDone = item.completedChunks?.length || 0;
          this.progress.currentChunkInfo = `Chunk ${initialDone} / ${totalChunks}`;
          this.emit();

          await sendLargeFileChunked({
            sourceDir: effectiveSourceDir,
            destinationDir: params.destinationDir,
            receiverUrl: activeReceiverUrl,
            token: params.token,
            item,
            concurrency: params.concurrency || 2,
            waitIfPausedOrOffline: () => this.waitIfPausedOrOffline(),
            throttleBytes: (b) => this.throttleBytes(b),
            onChunkSent: (bytesSent, doneChunks, totChunks, relPath) => {
              this.progress.bytesTransferred += bytesSent;
              this.activeSessionBytes += bytesSent;
              this.progress.currentFile = relPath;
              this.progress.currentChunkInfo = `Chunk ${doneChunks} / ${totChunks}`;
              this.emit();
            },
            onFileCompleted: (relPath) => {
              this.progress.filesCompleted += 1;
              this.progress.filesRemaining = Math.max(0, this.progress.filesRemaining - 1);
              this.log(`Verified & completed: ${relPath}`);
              this.emit();
            },
            onNetworkDrop: (errMsg) =>
              this.waitForReceiverRecovery(activeReceiverUrl, params.token, errMsg),
          });
        }
      }

      this.progress.state = "COMPLETED";
      this.progress.currentFile = null;
      this.progress.currentLane = null;
      this.progress.currentChunkInfo = null;
      this.log(
        `Backup 100% completed! (${this.progress.filesCompleted} transferred, ${this.progress.filesSkipped} skipped, 0 corrupted).`
      );
      this.emit();

      const durationSec = Math.max(1, Math.round((Date.now() - (this.progress.startedAt || Date.now())) / 1000));
      await appendTransferHistory({
        id: jobId,
        startedAt: this.progress.startedAt || Date.now(),
        finishedAt: Date.now(),
        durationSec,
        sourceDir: params.sourceDir,
        destinationDir: params.destinationDir,
        receiverUrl: activeReceiverUrl,
        filesTransferred: this.progress.filesCompleted,
        filesSkipped: this.progress.filesSkipped,
        bytesTransferred: this.progress.bytesTransferred,
        bytesSkipped: this.progress.bytesSkipped,
        avgSpeedMBps: Number(((this.progress.bytesTransferred / (1024 * 1024)) / durationSec).toFixed(2)),
        state: "COMPLETED",
      }).catch(() => {});

      return this.getProgress();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "TRANSFER_CANCELLED" || msg === "SCAN_ABORTED") {
        this.progress.state = "CANCELLED";
        this.log("Job stopped.");
      } else {
        this.progress.state = "ERROR";
        this.progress.errorMessage = msg;
        this.log(`Error: ${msg}`);
      }
      this.emit();
      return this.getProgress();
    }
  }

  /**
   * Performs a pre-flight Dry-Run scan & delta check against the Receiver
   * without transferring any bytes.
   */
  public async previewBackupPlan(
    params: StartTransferJobParams
  ): Promise<DryRunPreviewResponse> {
    const chunkSize = params.chunkSize || DEFAULT_CHUNK_SIZE;
    const resolvedSource = path.resolve(params.sourceDir);
    const scannedFiles = await scanSourceDirectory({
      sourceDir: resolvedSource,
      selectedItems: params.selectedItems,
      useSmartIgnore: params.useSmartIgnore,
      customIgnore: params.customIgnore,
    });

    const planUrl = `${params.receiverUrl.replace(/\/+$/, "")}/api/sync/plan`;
    const planRes = await fetch(planUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nova-Token": params.token,
      },
      body: JSON.stringify({
        destinationDir: params.destinationDir,
        files: scannedFiles,
        chunkSize,
      }),
    });

    if (!planRes.ok) {
      const errBody = await planRes.text();
      throw new Error(`Dry-Run gagal (${planRes.status}): ${errBody}`);
    }

    const syncPlan = (await planRes.json()) as SyncPlanResponse;
    const enoughSpace =
      syncPlan.freeBytes === 0 || syncPlan.freeBytes > syncPlan.summary.bytesToTransfer;

    this.log(
      `[DRY-RUN] ${syncPlan.summary.newCount} baru, ${syncPlan.summary.resumeCount} resume (${(
        syncPlan.summary.bytesToTransfer /
        (1024 * 1024)
      ).toFixed(2)} MB akan dikirim) • ${syncPlan.summary.skipCount} file sudah identik.`
    );
    this.emit();

    return {
      destinationDir: syncPlan.destinationDir,
      freeBytes: syncPlan.freeBytes,
      totalBytes: syncPlan.totalBytes,
      enoughSpace,
      summary: syncPlan.summary,
    };
  }
}
