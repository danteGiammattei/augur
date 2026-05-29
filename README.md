# AUGUR — Set I: The Two Lands

A collectible auto-battler (TFT-style) with an Egyptian first set. Create an augur,
pull gods from packs, build a court on a hex battlefield, and duel rival courts.
Combat is a deterministic seeded simulation, so the same seed always replays the same
fight — which is what lets a real phone-to-phone bump backend slot in later untouched.

Built with Vite + React. Progress is saved locally (localStorage).

---

## Fastest deploy — drag & drop (no build needed)

A production build is already included in **`dist/`**.

1. Go to Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Name the project (e.g. `augur`).
3. Drag the **contents of the `dist/` folder** (the `index.html` and `assets/` folder) into the uploader. Upload the *contents*, not the folder itself.
4. Deploy. Open the URL on your phone and create an account.

## Deploy from Git (rebuilds on push)

1. Push this folder to a GitHub repo.
2. Cloudflare → Pages → **Connect to Git** → pick the repo.
3. Build settings:
   - **Framework preset:** Vite (or None)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Deploy.

## Run / rebuild locally

```bash
npm install
npm run dev      # local dev server
npm run build    # outputs to dist/
npm run preview  # serve the production build locally
```

---

## How it plays

- **Onboarding:** name your augur, then pick 2 of 3 starter gods.
- **Court (Team):** deploy gods on your half of the hex field. Court size = player level + 1.
- **Codex (Collection):** every god grouped by cost; owned ones show a `copies/5` counter. Collect 5 copies, then spend coins to ascend a god's ★ (stats scale up).
- **Packs:** spend coins for a 5-card pack. Pull odds shown in-app.
- **Bump (The Crossing):** tap the eye (or physically knock two phones — the motion sensor is armed on this page) to find a rival and battle. Win for coins + XP; level up to grow your court.

Roles follow MOBA archetypes: **Tank, Fighter, Assassin, Mage, Support**, plus four
Egyptian factions (Netjeru, Duat, Desheret, Kemet) as a second synergy axis.

## Where the real multiplayer goes

`src/main.jsx` defines `window.storage` over localStorage. To make accounts real and
enable true phone-to-phone bump matchmaking, replace that shim with `fetch()` calls to a
Cloudflare Worker backed by D1 (accounts/collections) and a Durable Object that pairs two
players who bumped within ~1.5s, swaps their board JSON, and runs the same `simulateField`
seed on both devices. The combat engine in `src/App.jsx` is already a pure function for
exactly this reason.
