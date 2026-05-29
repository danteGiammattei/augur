# AUGUR — Cloudflare Pages + D1

A TFT-style collectible auto-battler. Static React (Vite) front end + Cloudflare
Pages Functions backed by D1 for **account persistence** (name + PIN, hashed
server-side, session token for saves). If no backend is reachable the app falls
back to **local-only play** automatically, so it still runs as a plain static site.

## Deploying

### A) Git / `wrangler pages deploy`  ← required for cloud sync (D1)
The `/api/*` Functions and D1 binding only ship when the **whole project**
(including `functions/`) is deployed.

1. Create the database and copy its id:
   ```
   npx wrangler d1 create augur-db
   ```
2. Bind it as `DB` — either paste the id into `wrangler.toml`
   (`database_id = "..."`), or in the dashboard:
   **Pages → your project → Settings → Functions → D1 bindings**, variable `DB` → `augur-db`.
3. Deploy:
   - **Git:** connect the repo; build command `npm run build`, output dir `dist`.
     Functions in `functions/` deploy automatically.
   - **Or CLI:** `npm run build && npx wrangler pages deploy dist`
     (run from the project root so `functions/` + `wrangler.toml` are picked up).

The `players` table auto-creates on first request, so `npm run db:init` is
optional. Run it if you want the schema applied up front.

### B) Drag-and-drop the built site (no D1)
Uploading just the contents of `dist/` (static Direct Upload) gives you the game
in **local-only** mode — no `/api`, so accounts live in the browser only. Fine for
a quick preview; use path (A) for real cloud accounts.

## Local dev
```
npm install
npm run dev          # vite, front end only (cloud calls 404 -> local fallback)
npm run pages:dev    # builds, then wrangler pages dev with a LOCAL D1
npm run db:init:local  # (optional) apply schema to the local D1
```

## Endpoints (POST, same-origin)
- `/api/register` `{name, pin, state}` → `{ok, token}`  (409 if name taken)
- `/api/login`    `{name, pin}`        → `{ok, token, state}`
- `/api/load`     `{name, token}`      → `{ok, state}`
- `/api/save`     `{name, token, state}` → `{ok}`

PINs are stored as `SHA-256(salt + ":" + pin)` with a per-account salt; the client
holds only a random session token. State is a single JSON blob per account.
