// Shared helpers. Files prefixed with _ are NOT routed by Pages — import-only.

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export async function sha256hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomHex(bytes = 24) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const cleanName = (n) => String(n || "").trim().slice(0, 16);
export const validPin = (p) => { p = String(p || ""); return p.length >= 4 && p.length <= 12; };

// Convenience: create the table on demand so no manual migration is strictly required.
export async function ensureSchema(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS players (name TEXT PRIMARY KEY, pin_hash TEXT NOT NULL, salt TEXT NOT NULL, token TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL)"
  ).run();
}
