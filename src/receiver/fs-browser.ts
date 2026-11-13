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
 * Returns quick-access drives and common folders for fast navigation.
 */
export async function getQuickRoots(): Promise<Array<{ label: string; path: string }>> {
  const roots: Array<{ label: string; path: string }> = [];
  const home = os.homedir();

  if (os.platform() === "win32") {
    // Detect available drive letters C:\ .. Z:\
    const driveLetters = ["C", "D", "E", "F", "G", "H"];
    for (const letter of driveLetters) {
      const drivePath = `${letter}:\\`;
      try {
        await fs.access(drivePath);
        roots.push({ label: `${letter}:`, path: drivePath });
      } catch {
        // Drive not mounted
      }
    }
    const commonFolders = [
      { label: "Home", path: home },
      { label: "Desktop", path: path.join(home, "Desktop") },
      { label: "Documents", path: path.join(home, "Documents") },
      { label: "Downloads", path: path.join(home, "Downloads") },
    ];
    for (const item of commonFolders) {
      try {
        const st = await fs.stat(item.path);
        if (st.isDirectory()) roots.push(item);
      } catch {
        // Skip missing
      }
    }
  } else {
    const linuxRoots = [
      { label: "Home", path: home },
      { label: "Backups", path: path.join(home, "NovaShare-Backups") },
      { label: "/", path: "/" },
      { label: "/mnt", path: "/mnt" },
      { label: "/media", path: "/media" },
    ];
    for (const item of linuxRoots) {
      try {
        const st = await fs.stat(item.path);
        if (st.isDirectory()) roots.push(item);
      } catch {
        // Skip missing
      }
    }
  }

  return roots;
}

/**
 * Lists directories (and files) at a given path on the Receiver/Sender machine.
 */
export async function browseDirectory(requestedPath?: string): Promise<BrowseResponse> {
  const defaultDir = path.join(os.homedir(), "NovaShare-Backups");
  let targetPath = requestedPath && requestedPath.trim() ? requestedPath.trim() : os.homedir();
  targetPath = path.resolve(targetPath);

  if (targetPath === defaultDir) {
    await fs.mkdir(targetPath, { recursive: true }).catch(() => {});
  }

  // If the requested path does not exist yet, walk up to the nearest existing directory
  while (true) {
    try {
      const st = await fs.stat(targetPath);
      if (st.isDirectory()) break;
      targetPath = path.dirname(targetPath);
    } catch {
      const parent = path.dirname(targetPath);
      if (parent === targetPath) {
        targetPath = os.homedir();
        break;
      }
      targetPath = parent;
    }
  }

  const dirents = await fs.readdir(targetPath, { withFileTypes: true });
  const entries: DirectoryEntry[] = [];

  for (const d of dirents) {
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
      // Ignore locked system files (e.g. pagefile.sys, System Volume Information)
    }
  }

  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const parentDir = path.dirname(targetPath);
  const parentPath = parentDir !== targetPath ? parentDir : null;
  const [{ freeBytes, totalBytes }, roots] = await Promise.all([
    getDiskSpace(targetPath),
    getQuickRoots(),
  ]);

  return {
    currentPath: targetPath,
    parentPath,
    platform: os.platform(),
    hostname: os.hostname(),
    freeBytes,
    totalBytes,
    entries,
    roots,
  };
}

/**
 * Creates a new directory on the Receiver/Sender machine.
 */
export async function createDirectory(targetPath: string): Promise<{ path: string; created: boolean }> {
  if (!targetPath || !targetPath.trim()) {
    throw new Error("Target directory path is required");
  }
  const resolved = path.resolve(targetPath.trim());
  await fs.mkdir(resolved, { recursive: true });
  return { path: resolved, created: true };
}

/**
 * Safely deletes a file or directory on the Receiver machine.
 * Protects filesystem roots and user home root from accidental deletion.
 */
export async function deletePathOnDisk(
  targetPath: string
): Promise<{ path: string; deleted: boolean }> {
  if (!targetPath || !targetPath.trim()) {
    throw new Error("Target path is required");
  }
  const resolved = path.resolve(targetPath.trim());
  const parent = path.dirname(resolved);
  const home = path.resolve(os.homedir());
  if (resolved === parent || resolved === home) {
    throw new Error(`Refusing to delete protected root directory: ${resolved}`);
  }
  await fs.rm(resolved, { recursive: true, force: false });
  return { path: resolved, deleted: true };
}

/**
 * Renames a file or directory within its parent directory.
 */
export async function renamePathOnDisk(
  oldPath: string,
  newNameOrPath: string
): Promise<{ oldPath: string; newPath: string; renamed: boolean }> {
  if (!oldPath?.trim() || !newNameOrPath?.trim()) {
    throw new Error("Both oldPath and newPath are required");
  }
  const resolvedOld = path.resolve(oldPath.trim());
  const cleanNew = newNameOrPath.trim();
  const resolvedNew =
    cleanNew.includes("/") || cleanNew.includes("\\")
      ? path.resolve(cleanNew)
      : path.join(path.dirname(resolvedOld), cleanNew);

  await fs.rename(resolvedOld, resolvedNew);
  return { oldPath: resolvedOld, newPath: resolvedNew, renamed: true };
}
