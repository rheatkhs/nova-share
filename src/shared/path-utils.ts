import * as path from "node:path";

/**
 * Converts Windows backslashes (\) to POSIX forward slashes (/)
 * and strips leading slashes.
 */
export function toPosixRelative(relPath: string): string {
  return relPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

/**
 * Validates and resolves a relative path inside a target root directory.
 * Throws an Error if path traversal (e.g. "../") attempts to escape `rootDir`.
 */
export function resolveSafeChildPath(rootDir: string, relativePath: string): string {
  const normalizedRel = toPosixRelative(relativePath);
  if (!normalizedRel || normalizedRel === "." || normalizedRel.includes("\0")) {
    throw new Error(`Invalid relative path: "${relativePath}"`);
  }

  const segments = normalizedRel.split("/");
  for (const seg of segments) {
    if (seg === "..") {
      throw new Error(`Path traversal detected in relative path: "${relativePath}"`);
    }
  }

  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, normalizedRel);

  // Ensure resolvedTarget stays strictly within resolvedRoot
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(rootWithSep)) {
    throw new Error(`Path escapes destination directory: "${relativePath}"`);
  }

  return resolvedTarget;
}

/**
 * Checks if a relative path matches any ignore pattern.
 */
export function shouldIgnorePath(relativePath: string, patterns: string[]): boolean {
  const posix = toPosixRelative(relativePath);
  const parts = posix.split("/");
  const fileName = parts[parts.length - 1] || "";

  for (const rawPattern of patterns) {
    const pattern = rawPattern.trim();
    if (!pattern) continue;

    // Wildcard suffix match e.g. "*.novapart" or "*.tmp"
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1); // ".novapart"
      if (fileName.endsWith(ext)) return true;
      continue;
    }

    // Exact directory/segment match e.g. "node_modules", ".git"
    const cleanPattern = pattern.replace(/^\/+|\/+$/g, "");
    if (parts.includes(cleanPattern) || fileName === cleanPattern) {
      return true;
    }
  }

  return false;
}
