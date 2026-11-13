/**
 * Fast cryptographic hashing using Bun's native C/Zig CryptoHasher (SHA-256).
 */
export function hashBuffer(data: Uint8Array | ArrayBuffer): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

/**
 * Constant-time-like string comparison for tokens & hashes
 */
export function safeCompareHex(a: string, b: string): boolean {
  if (!a || !b) return false;
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (normA.length !== normB.length) return false;
  let diff = 0;
  for (let i = 0; i < normA.length; i++) {
    diff |= normA.charCodeAt(i) ^ normB.charCodeAt(i);
  }
  return diff === 0;
}
