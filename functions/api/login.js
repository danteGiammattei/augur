import { json, sha256hex, cleanName, ensureSchema } from "./_common.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  await ensureSchema(env);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "bad-json" }, 400);
  const name = cleanName(body.name);

  const row = await env.DB.prepare("SELECT * FROM players WHERE name = ?").bind(name).first();
  if (!row) return json({ error: "not-found" }, 404);

  const h = await sha256hex(row.salt + ":" + String(body.pin || ""));
  if (h !== row.pin_hash) return json({ error: "bad-pin" }, 401);

  return json({ ok: true, token: row.token, state: row.state });
}
