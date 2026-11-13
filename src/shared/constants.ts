export const APP_VERSION = "1.0.0";

/**
 * Default chunk size for large files (>= 8 MB): 8 MiB
 */
export const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024; // 8,388,608 bytes

/**
 * Files strictly smaller than this threshold go through Lane A (Micro-Batching)
 */
export const SMALL_FILE_THRESHOLD = 8 * 1024 * 1024; // 8 MiB

/**
 * Maximum payload size for a single Micro-Batch request: ~8 MiB
 */
export const MAX_BATCH_BYTES = 8 * 1024 * 1024;

/**
 * Maximum number of files packed in a single Micro-Batch request
 */
export const MAX_BATCH_FILES = 200;

/**
 * Default ports
 */
export const DEFAULT_SENDER_PORT = 7650;
export const DEFAULT_RECEIVER_PORT = 7654;

/**
 * Default token for local/dev mode if NOVA_TOKEN is not provided
 */
export const DEFAULT_TOKEN = "novashare-secret-2026";

/**
 * Default smart ignore patterns (can be toggled in UI)
 */
export const DEFAULT_IGNORE_PATTERNS: string[] = [
  "node_modules",
  ".git",
  "vendor",
  ".next",
  "dist",
  ".cache",
  "Thumbs.db",
  ".DS_Store",
  "*.novapart",
  "*.novapart.meta.json",
];
