import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_IGNORE_PATTERNS } from "../shared/constants.ts";
import { shouldIgnorePath, toPosixRelative } from "../shared/path-utils.ts";
import type { FileScanEntry } from "../shared/types.ts";

export interface ScanFolderOptions {
  sourceDir: string;
  useSmartIgnore?: boolean;
  customIgnore?: string[];
  onProgress?: (scannedCount: number, currentRelPath: string) => void;
  shouldAbort?: () => boolean;
}

/**
 * Recursively scans a Windows/local directory and builds a normalized list
 * of files with relative POSIX paths, sizes, and modification timestamps.
 */
export async function scanSourceDirectory(
  options: ScanFolderOptions
): Promise<FileScanEntry[]> {
  const rootDir = path.resolve(options.sourceDir);
  const rootStat = await fs.stat(rootDir);
  if (!rootStat.isDirectory()) {
    throw new Error(`Source path is not a directory: ${rootDir}`);
  }

  const ignorePatterns: string[] = [
    ...(options.useSmartIgnore !== false ? DEFAULT_IGNORE_PATTERNS : ["*.novapart", "*.novapart.meta.json"]),
    ...(options.customIgnore || []),
  ];

  const results: FileScanEntry[] = [];

  async function walk(currentDir: string): Promise<void> {
    if (options.shouldAbort?.()) {
      throw new Error("SCAN_ABORTED");
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (options.shouldAbort?.()) {
        throw new Error("SCAN_ABORTED");
      }

      const fullPath = path.join(currentDir, entry.name);
      const relPath = toPosixRelative(path.relative(rootDir, fullPath));

      if (shouldIgnorePath(relPath, ignorePatterns)) {
        continue;
      }

      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await walk(fullPath);
        } else if (stat.isFile()) {
          results.push({
            relativePath: relPath,
            absolutePath: fullPath,
            size: stat.size,
            mtime: Math.floor(stat.mtimeMs),
          });
          options.onProgress?.(results.length, relPath);
        }
      } catch {
        // Skip unreadable or locked OS system files
      }
    }
  }

  await walk(rootDir);
  return results;
}
