const hashCache: Record<string, string> = {};

export async function sha256(str: string): Promise<string> {
  if (hashCache[str]) return hashCache[str];
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  hashCache[str] = hex;
  return hex;
}

export function getHashSync(str: string): string {
  return hashCache[str] || "";
}

export async function precomputeHashes(files: string[]): Promise<void> {
  await Promise.all(files.map((f) => sha256(f)));
}

export function esc(str: string): string {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
