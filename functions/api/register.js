import { json, sha256hex, randomHex, cleanName, validPin, ensureSchema } from "./_common.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  await ensureSchema(env);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "bad-json" }, 400);
  const name = cleanName(body.name);
  if (!name) return json({ error: "bad-name" }, 400);
  if (!validPin(body.pin)) return json({ error: "bad-pin" }, 400);

  const existing = await env.DB.prepare("SELECT name FROM players WHERE name = ?").bind(name).first();
  if (existing) return json({ error: "taken" }, 409);

  const salt = randomHex(16);
  const pin_hash = await sha256hex(salt + ":" + String(body.pin));
  const token = randomHex(24);
  const state = typeof body.state === "string" ? body.state : JSON.stringify(body.state || {});

  await env.DB.prepare(
    "INSERT INTO players (name, pin_hash, salt, token, state, updated_at) VALUES (?,?,?,?,?,?)"
  ).bind(name, pin_hash, salt, token, state, Date.now()).run();

  return json({ ok: true, token, name });
}
