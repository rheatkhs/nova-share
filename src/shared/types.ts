export interface FileScanEntry {
  /** Normalized POSIX relative path (e.g., "docs/report.pdf") */
  relativePath: string;
  /** Absolute path on the sender machine */
  absolutePath?: string;
  /** File size in bytes */
  size: number;
  /** Last modified timestamp in milliseconds (epoch ms) */
  mtime: number;
}

export type SyncAction = "SKIP" | "RESUME" | "NEW";

export interface SyncPlanItem {
  relativePath: string;
  size: number;
  mtime: number;
  action: SyncAction;
  /** For RESUME items: indices of 8MB chunks already verified on disk */
  completedChunks?: number[];
  chunkSize?: number;
}

export interface SyncPlanRequest {
  destinationDir: string;
  files: FileScanEntry[];
  chunkSize?: number;
}

export interface SyncPlanResponse {
  destinationDir: string;
  freeBytes: number;
  totalBytes: number;
  plan: SyncPlanItem[];
  summary: {
    totalFiles: number;
    skipCount: number;
    resumeCount: number;
    newCount: number;
    bytesToTransfer: number;
    bytesSkipped: number;
  };
}

export interface ChunkMetaFile {
  relativePath: string;
  totalSize: number;
  sourceMtime: number;
  chunkSize: number;
  totalChunks: number;
  completedChunks: number[];
}

export interface BatchFileHeaderItem {
  relativePath: string;
  size: number;
  mtime: number;
  offset: number;
  hash: string;
}

export interface BatchManifestHeader {
  destinationDir: string;
  files: BatchFileHeaderItem[];
  payloadHash: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  mtime: number;
}

export interface BrowseResponse {
  currentPath: string;
  parentPath: string | null;
  platform: string;
  hostname: string;
  freeBytes: number;
  totalBytes: number;
  entries: DirectoryEntry[];
  roots?: Array<{ label: string; path: string }>;
}

export interface ReceiverSystemInfo {
  name: string;
  version: string;
  hostname: string;
  platform: string;
  arch: string;
  uptimeSeconds: number;
  defaultBackupDir: string;
}

export interface BackupProfile {
  id: string;
  name: string;
  sourceDir: string;
  destinationDir: string;
  receiverUrl: string;
  token: string;
  useSmartIgnore: boolean;
  customIgnore: string[];
  bandwidthLimitMBps: number; // 0 = unlimited
  concurrency: number;
  lastRunAt?: number;
}

export type TransferState =
  | "IDLE"
  | "SCANNING"
  | "PLANNING"
  | "TRANSFERRING"
  | "PAUSED"
  | "WAITING_FOR_NETWORK"
  | "COMPLETED"
  | "CANCELLED"
  | "ERROR";

export interface TransferProgress {
  state: TransferState;
  jobId: string | null;
  sourceDir: string;
  destinationDir: string;
  receiverUrl: string;
  startedAt: number | null;
  updatedAt: number;
  totalFiles: number;
  filesCompleted: number;
  filesSkipped: number;
  filesRemaining: number;
  totalBytes: number;
  bytesTransferred: number;
  bytesSkipped: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  currentFile: string | null;
  currentLane: "BATCH" | "CHUNK" | null;
  currentChunkInfo: string | null;
  errorMessage: string | null;
  recentLogs: string[];
}
