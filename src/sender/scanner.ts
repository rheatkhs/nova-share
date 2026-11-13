import * as fs from "node:fs/promises";
import * as path from "node:path";
import { DEFAULT_IGNORE_PATTERNS } from "../shared/constants.ts";
import { shouldIgnorePath, toPosixRelative } from "../shared/path-utils.ts";
import type { FileScanEntry } from "../shared/types.ts";

export interface ScanFolderOptions {
  sourceDir: string;
  /** Optional list of specific file/folder names or relative paths inside sourceDir to transfer */
  selectedItems?: string[];
  useSmartIgnore?: boolean;
  customIgnore?: string[];
  onProgress?: (scannedCount: number, currentRelPath: string) => void;
  shouldAbort?: () => boolean;
}

/**
 * Scans a source directory (or a single file, or a subset of selected items inside a directory)
 * and builds a normalized list of files with relative POSIX paths, sizes, and modification timestamps.
 */
export async function scanSourceDirectory(
  options: ScanFolderOptions
): Promise<FileScanEntry[]> {
  const rootPath = path.resolve(options.sourceDir);
  const rootStat = await fs.stat(rootPath);

  // Support single-file transfer if sourceDir points directly to a file
  if (rootStat.isFile()) {
    const fileName = path.basename(rootPath);
    options.onProgress?.(1, fileName);
    return [
      {
        relativePath: toPosixRelative(fileName),
        absolutePath: rootPath,
        size: rootStat.size,
        mtime: Math.floor(rootStat.mtimeMs),
      },
    ];
  }

  if (!rootStat.isDirectory()) {
    throw new Error(`Source path is neither a file nor a directory: ${rootPath}`);
  }

  const ignorePatterns: string[] = [
    ...(options.useSmartIgnore !== false
      ? DEFAULT_IGNORE_PATTERNS
      : ["*.novapart", "*.novapart.meta.json"]),
    ...(options.customIgnore || []),
  ];

  const selectedSet =
    options.selectedItems && options.selectedItems.length > 0
      ? new Set(options.selectedItems.map((s) => toPosixRelative(s)))
      : null;

  const results: FileScanEntry[] = [];

  async function walk(currentDir: string, isRootLevel: boolean): Promise<void> {
    if (options.shouldAbort?.()) {
      throw new Error("SCAN_ABORTED");
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (options.shouldAbort?.()) {
        throw new Error("SCAN_ABORTED");
      }

      const fullPath = path.join(currentDir, entry.name);
      const relPath = toPosixRelative(path.relative(rootPath, fullPath));

      // If the user explicitly selected items at the top level, filter to only those items
      if (isRootLevel && selectedSet && !selectedSet.has(relPath) && !selectedSet.has(entry.name)) {
        continue;
      }

      // Apply Smart Ignore only to unselected traversal (if user explicitly checked a file, allow it)
      const explicitlySelected =
        selectedSet && (selectedSet.has(relPath) || selectedSet.has(entry.name));
      if (!explicitlySelected && shouldIgnorePath(relPath, ignorePatterns)) {
        continue;
      }

      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await walk(fullPath, false);
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

  await walk(rootPath, true);
  return results;
}
