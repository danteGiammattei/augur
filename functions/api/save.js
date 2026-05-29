import { json, cleanName, ensureSchema } from "./_common.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "no-db" }, 503);
  await ensureSchema(env);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "bad-json" }, 400);
  const name = cleanName(body.name);

  const row = await env.DB.prepare("SELECT token FROM players WHERE name = ?").bind(name).first();
  if (!row) return json({ error: "not-found" }, 404);
  if (row.token !== body.token) return json({ error: "bad-token" }, 401);

  const state = typeof body.state === "string" ? body.state : JSON.stringify(body.state || {});
  if (state.length > 200000) return json({ error: "too-big" }, 413);

  await env.DB.prepare("UPDATE players SET state = ?, updated_at = ? WHERE name = ?")
    .bind(state, Date.now(), name).run();
  return json({ ok: true });
}
