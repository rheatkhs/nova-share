import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { BrowseResponse, DirectoryEntry } from "../shared/types.ts";

/**
 * Queries free and total disk space for a given directory path.
 * Uses Node/Bun's `fs.statfs` when available, with safe fallback.
 */
export async function getDiskSpace(targetPath: string): Promise<{ freeBytes: number; totalBytes: number }> {
  try {
    let checkPath = path.resolve(targetPath);
    // Walk up if directory does not exist yet
    while (true) {
      try {
        await fs.access(checkPath);
        break;
      } catch {
        const parent = path.dirname(checkPath);
        if (parent === checkPath) break;
        checkPath = parent;
      }
    }

    if (typeof fs.statfs === "function") {
      const stats = await fs.statfs(checkPath);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      return { freeBytes, totalBytes };
    }
  } catch {
    // Fallback if statfs fails
  }
  return { freeBytes: 0, totalBytes: 0 };
}

/**
 * Lists directories (and files) at a given path on the Receiver machine.
 */
export async function browseDirectory(requestedPath?: string): Promise<BrowseResponse> {
  const defaultDir = path.join(os.homedir(), "NovaShare-Backups");
  let targetPath = requestedPath && requestedPath.trim() ? requestedPath.trim() : os.homedir();
  targetPath = path.resolve(targetPath);

  // If requested path is the default backup dir and doesn't exist yet, create it
  if (targetPath === defaultDir) {
    await fs.mkdir(targetPath, { recursive: true }).catch(() => {});
  }

  const stat = await fs.stat(targetPath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${targetPath}`);
  }

  const dirents = await fs.readdir(targetPath, { withFileTypes: true });
  const entries: DirectoryEntry[] = [];

  for (const d of dirents) {
    // Skip internal temporary files from directory browser clutter
    if (d.name.endsWith(".novapart") || d.name.endsWith(".novapart.meta.json")) {
      continue;
    }

    const fullPath = path.join(targetPath, d.name);
    try {
      const itemStat = await fs.stat(fullPath);
      entries.push({
        name: d.name,
        path: fullPath,
        isDirectory: itemStat.isDirectory(),
        size: itemStat.size,
        mtime: Math.floor(itemStat.mtimeMs),
      });
    } catch {
      // Ignore broken symlinks or permission-denied entries
    }
  }

  // Sort directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const parentDir = path.dirname(targetPath);
  const parentPath = parentDir !== targetPath ? parentDir : null;
  const { freeBytes, totalBytes } = await getDiskSpace(targetPath);

  return {
    currentPath: targetPath,
    parentPath,
    platform: os.platform(),
    hostname: os.hostname(),
    freeBytes,
    totalBytes,
    entries,
  };
}

/**
 * Creates a new directory on the Receiver machine.
 */
export async function createDirectory(targetPath: string): Promise<{ path: string; created: boolean }> {
  if (!targetPath || !targetPath.trim()) {
    throw new Error("Target directory path is required");
  }
  const resolved = path.resolve(targetPath.trim());
  await fs.mkdir(resolved, { recursive: true });
  return { path: resolved, created: true };
}
