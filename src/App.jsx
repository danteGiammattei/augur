import React, { useState, useEffect, useRef, useMemo } from "react";

/* ============================================================
   AUGUR — v0.3 · the field awakens
   Hex battlefield: units acquire targets, walk, attack (melee/ranged),
   and cast spells. Combat is a deterministic frame-recording sim from a
   seed — simulateField(boardA, boardB, seed) → {winner, frames}. Pure,
   so it still drops into a Cloudflare bump-matcher untouched.
   ============================================================ */

/* ---------- PRNG ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randSeed = () => (Date.now() ^ (Math.random() * 1e9)) >>> 0;

/* ============================================================
   HEX FIELD GEOMETRY  (odd-r offset, pointy-top)
   rows 0..2 = enemy half · rows 3..5 = player half
   ============================================================ */
const COLS = 7, ROWS = 6, MID = 3;
const BW = 336;
const HEXW = BW / (COLS + 0.5);
const SIZE = HEXW / Math.sqrt(3);
const ROWH = SIZE * 1.5;
const BH = ROWH * (ROWS - 1) + SIZE * 2;
const TOK = HEXW * 0.84;

const cx = (col, row) => HEXW * (col + 0.5 * (row & 1)) + HEXW / 2;
const cy = (row) => SIZE + ROWH * row;

function oddrToCube(col, row) {
  const x = col - (row - (row & 1)) / 2, z = row, y = -x - z;
  return { x, y, z };
}
function hexDist(a, b) {
  const A = oddrToCube(a.col, a.row), B = oddrToCube(b.col, b.row);
  return (Math.abs(A.x - B.x) + Math.abs(A.y - B.y) + Math.abs(A.z - B.z)) / 2;
}
function neighbors(col, row) {
  const even = (row & 1) === 0;
  const ds = even
    ? [[-1, 0], [1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]]
    : [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]];
  return ds.map(([dc, dr]) => ({ col: col + dc, row: row + dr }))
    .filter((c) => c.col >= 0 && c.col < COLS && c.row >= 0 && c.row < ROWS);
}
const key = (c) => c.col + "," + c.row;

/* ============================================================
   SET I — THE TWO LANDS (Egyptian)
   ============================================================ */
const HEROES = [
  { id: "ammit", name: "Ammit", origin: "duat", cls: "assassin", cost: 1, hp: 460, ad: 40, as: 0.85, mana: 10, maxMana: 75, magic: 15, armor: 16, ability: "Devour", aType: "execute" },
  { id: "bes", name: "Bes", origin: "desheret", cls: "tank", cost: 1, hp: 720, ad: 36, as: 0.55, mana: 30, maxMana: 90, magic: 0, armor: 40, ability: "Ward of the Hearth", aType: "shield_self" },
  { id: "hapi", name: "Hapi", origin: "kemet", cls: "support", cost: 1, hp: 480, ad: 34, as: 0.6, mana: 10, maxMana: 80, magic: 30, armor: 20, ability: "Flood Blessing", aType: "shield_team" },
  { id: "khonsu", name: "Khonsu", origin: "netjeru", cls: "assassin", cost: 2, hp: 520, ad: 48, as: 0.8, mana: 0, maxMana: 80, magic: 20, armor: 20, ability: "Lunar Edge", aType: "execute" },
  { id: "nephthys", name: "Nephthys", origin: "duat", cls: "support", cost: 2, hp: 560, ad: 38, as: 0.6, mana: 30, maxMana: 95, magic: 45, armor: 24, ability: "Mourning Rite", aType: "heal_team" },
  { id: "apep", name: "Apep", origin: "desheret", cls: "mage", cost: 2, hp: 500, ad: 38, as: 0.6, mana: 20, maxMana: 95, magic: 60, armor: 18, ability: "Venom Flood", aType: "aoe" },
  { id: "sobek", name: "Sobek", origin: "kemet", cls: "tank", cost: 2, hp: 820, ad: 42, as: 0.55, mana: 30, maxMana: 100, magic: 0, armor: 48, ability: "Scaled Hide", aType: "shield_self" },
  { id: "horus", name: "Horus", origin: "kemet", cls: "fighter", cost: 2, hp: 540, ad: 50, as: 0.85, mana: 0, maxMana: 80, magic: 20, armor: 22, ability: "Falcon Dive", aType: "evade" },
  { id: "nut", name: "Nut", origin: "netjeru", cls: "support", cost: 3, hp: 650, ad: 40, as: 0.6, mana: 40, maxMana: 110, magic: 55, armor: 30, ability: "Vault of Heaven", aType: "shield_team" },
  { id: "anubis", name: "Anubis", origin: "duat", cls: "assassin", cost: 3, hp: 620, ad: 50, as: 0.7, mana: 10, maxMana: 85, magic: 30, armor: 28, ability: "Weigh the Heart", aType: "execute" },
  { id: "sekhmet", name: "Sekhmet", origin: "desheret", cls: "mage", cost: 3, hp: 560, ad: 44, as: 0.68, mana: 10, maxMana: 100, magic: 80, armor: 20, ability: "Lioness' Wrath", aType: "multi" },
  { id: "isis", name: "Isis", origin: "kemet", cls: "support", cost: 3, hp: 600, ad: 40, as: 0.62, mana: 20, maxMana: 105, magic: 65, armor: 26, ability: "Rite of Life", aType: "heal_team" },
  { id: "thoth", name: "Thoth", origin: "netjeru", cls: "mage", cost: 4, hp: 520, ad: 42, as: 0.65, mana: 10, maxMana: 100, magic: 90, armor: 18, ability: "Word of Creation", aType: "nuke" },
  { id: "osiris", name: "Osiris", origin: "duat", cls: "tank", cost: 4, hp: 1000, ad: 48, as: 0.55, mana: 30, maxMana: 115, magic: 20, armor: 55, ability: "Eternal Throne", aType: "shield_self" },
  { id: "set", name: "Set", origin: "desheret", cls: "fighter", cost: 4, hp: 680, ad: 62, as: 0.75, mana: 0, maxMana: 90, magic: 25, armor: 26, ability: "Storm of Ombos", aType: "aoe_phys" },
  { id: "ra", name: "Ra", origin: "netjeru", cls: "mage", cost: 5, hp: 650, ad: 55, as: 0.7, mana: 0, maxMana: 125, magic: 110, armor: 25, ability: "Solar Annihilation", aType: "aoe" },
];
const HERO = Object.fromEntries(HEROES.map((h) => [h.id, h]));

const ORIGINS = {
  netjeru: { label: "Netjeru", glyph: "☉", ink: "#2d5f7c", breaks: [2, 4] },
  duat: { label: "Duat", glyph: "𓂀", ink: "#5a4170", breaks: [2, 4] },
  desheret: { label: "Desheret", glyph: "𓆙", ink: "#a8331f", breaks: [2, 4] },
  kemet: { label: "Kemet", glyph: "𓈗", ink: "#3f7a63", breaks: [2, 4] },
};
const CLASSES = {
  tank: { label: "Tank", glyph: "⛨", ink: "#7a5a2e", breaks: [2, 3], range: 1, moveCd: 0.34 },
  fighter: { label: "Fighter", glyph: "⚔", ink: "#b5662a", breaks: [2], range: 1, moveCd: 0.28 },
  assassin: { label: "Assassin", glyph: "☠", ink: "#8a2b2b", breaks: [2, 3], range: 1, moveCd: 0.22 },
  mage: { label: "Mage", glyph: "✶", ink: "#3b5e8c", breaks: [2, 4], range: 3, moveCd: 0.32 },
  support: { label: "Support", glyph: "✚", ink: "#4a6b52", breaks: [2, 4], range: 2, moveCd: 0.32 },
};
const TRAIT_TEXT = {
  netjeru: ["allies gain +20 starting mana", "allies gain +20 mana & +30 magic"],
  duat: ["heal team 10% of a slain foe's max HP", "heal team 22% of a slain foe's max HP"],
  desheret: ["allies gain +14 attack damage", "allies gain +34 attack damage"],
  kemet: ["allies gain +12% max HP", "allies gain +28% max HP & a 150 shield"],
  tank: ["allies gain +35 armor", "allies gain +80 armor & +12% max HP"],
  fighter: ["allies gain +20 attack damage & +10% max HP"],
  assassin: ["allies gain +0.15 attack speed", "allies gain +0.35 attack speed & +25 AD"],
  mage: ["allies gain +40 magic", "allies gain +110 magic"],
  support: ["allies gain +30 magic & +10 mana", "allies gain +70 magic & +25 mana"],
};
const BLURB = {
  ammit: "Devours the weakest foe and heals itself.",
  bes: "Throws up a heavy shield on itself.",
  hapi: "Shields the whole court against the next blows.",
  khonsu: "Cuts the weakest foe; finishes the dying.",
  nephthys: "Heals every ally at once.",
  apep: "Floods the field with venom, hitting all foes.",
  sobek: "Hardens its scales into a large shield.",
  horus: "Gains dodge and attack speed, slipping counters.",
  nut: "Shields the whole court for a long while.",
  anubis: "Judges a foe — executes it below 30% life.",
  sekhmet: "Rends the three weakest enemies.",
  isis: "Pours a large heal across the court.",
  thoth: "Unmakes the weakest foe with a huge bolt.",
  osiris: "Massive self-shield — refuses to fall.",
  set: "A desert storm flays the whole enemy line.",
  ra: "Solar fire scorches every enemy.",
};

function computeTraits(board) {
  const oc = {}, cc = {};
  board.forEach((p) => { const h = HERO[p.heroId]; oc[h.origin] = (oc[h.origin] || 0) + 1; cc[h.cls] = (cc[h.cls] || 0) + 1; });
  const out = [];
  const push = (k, d, n, kind) => { if (!n) return; let tier = -1; d.breaks.forEach((b, i) => { if (n >= b) tier = i; });
    out.push({ key: k, kind, label: d.label, glyph: d.glyph, ink: d.ink, count: n, breaks: d.breaks, tier, active: tier >= 0 }); };
  Object.entries(ORIGINS).forEach(([k, d]) => push(k, d, oc[k], "origin"));
  Object.entries(CLASSES).forEach(([k, d]) => push(k, d, cc[k], "class"));
  return out.sort((a, b) => (b.active - a.active) || (b.count - a.count));
}

const starMult = (s) => Math.pow(1.8, (s || 1) - 1);

function buildSide(board, side) {
  const traits = computeTraits(board).filter((t) => t.active);
  const tierOf = {}; traits.forEach((t) => (tierOf[t.key] = t.tier));
  const has = (k) => tierOf[k] !== undefined;
  const m = { hpPct: 0, ad: 0, magic: 0, armor: 0, as: 0, dodge: 0, startShield: 0, startMana: 0, ppHeal: 0 };
  if (has("netjeru")) { m.startMana += 20; if (tierOf.netjeru === 1) m.magic += 30; }
  if (has("duat")) m.ppHeal = tierOf.duat === 1 ? 0.22 : 0.10;
  if (has("desheret")) m.ad += tierOf.desheret === 1 ? 34 : 14;
  if (has("kemet")) { m.hpPct += tierOf.kemet === 1 ? 0.28 : 0.12; if (tierOf.kemet === 1) m.startShield += 150; }
  if (has("tank")) { m.armor += tierOf.tank === 1 ? 80 : 35; if (tierOf.tank === 1) m.hpPct += 0.12; }
  if (has("fighter")) { m.ad += 20; m.hpPct += 0.10; }
  if (has("assassin")) { m.as += tierOf.assassin === 1 ? 0.35 : 0.15; if (tierOf.assassin === 1) m.ad += 25; }
  if (has("mage")) m.magic += tierOf.mage === 1 ? 110 : 40;
  if (has("support")) { m.magic += tierOf.support === 1 ? 70 : 30; m.startMana += tierOf.support === 1 ? 25 : 10; }

  return board.map((p, i) => {
    const h = HERO[p.heroId]; const sm = starMult(p.star || 1);
    const cl = CLASSES[h.cls];
    const as = +(h.as + m.as).toFixed(2);
    const maxHp = Math.round(h.hp * sm * (1 + m.hpPct));
    return {
      uid: side + i, heroId: h.id, name: h.name, side, star: p.star || 1, origin: h.origin, cls: h.cls,
      col: p.col, row: p.row, maxHp, hp: maxHp,
      ad: Math.round(h.ad * sm + m.ad), as, magic: Math.round(h.magic * sm + m.magic),
      armor: h.armor + m.armor, dodge: Math.min(0.6, m.dodge), shield: m.startShield,
      mana: Math.min(h.maxMana, h.mana + m.startMana), maxMana: h.maxMana,
      ability: h.ability, aType: h.aType, range: cl.range, moveCd: cl.moveCd,
      atkTimer: (1 / Math.max(0.2, as)) * 0.5, moveTimer: 0, target: null, ppHeal: m.ppHeal,
    };
  });
}

/* ============================================================
   SPATIAL COMBAT — records a frame each tick
   ============================================================ */
function simulateField(boardA, boardB, seed) {
  const rng = mulberry32(seed);
  const units = [...buildSide(boardA, "A"), ...buildSide(boardB, "B")];
  const byUid = Object.fromEntries(units.map((u) => [u.uid, u]));
  const occ = new Map();
  units.forEach((u) => occ.set(key(u), u.uid));

  const living = (s) => units.filter((u) => u.hp > 0 && u.side === s);
  const foes = (u) => living(u.side === "A" ? "B" : "A");
  const friends = (u) => living(u.side);
  const nearest = (u) => { let best = null, bd = 1e9; for (const e of foes(u)) { const d = hexDist(u, e); if (d < bd || (d === bd && best && e.uid < best.uid)) { bd = d; best = e; } } return best; };
  const lowest = (u) => { let best = null, bh = 1e9; for (const e of foes(u)) { if (e.hp < bh || (e.hp === bh && best && e.uid < best.uid)) { bh = e.hp; best = e; } } return best; };
  const adjFree = (e) => neighbors(e.col, e.row).some((n) => !occ.has(key(n)));
  // melee prefers the nearest enemy it can actually reach (has an open adjacent hex);
  // ranged just takes the nearest since it fires over the front line.
  const pickTarget = (u, exclude) => {
    if (u.range > 1) return nearest(u);
    let best = null, bs = 1e9;
    for (const e of foes(u)) {
      if (exclude && e.uid === exclude) continue;
      const engageable = hexDist(u, e) <= 1 || adjFree(e);
      const score = hexDist(u, e) + (engageable ? 0 : 100);
      if (score < bs || (score === bs && best && e.uid < best.uid)) { bs = score; best = e; }
    }
    return best || nearest(u);
  };

  const frames = [];
  let fx = [];
  const damage = (src, tgt, amount, magic) => {
    if (tgt.hp <= 0) return 0;
    if (!magic && rng() < tgt.dodge) { fx.push({ k: "miss", tc: { col: tgt.col, row: tgt.row } }); return 0; }
    let dmg = amount; if (!magic) dmg *= 100 / (100 + tgt.armor);
    dmg = Math.max(1, Math.round(dmg));
    if (tgt.shield > 0) { const a = Math.min(tgt.shield, dmg); tgt.shield -= a; dmg -= a; }
    tgt.hp -= dmg; tgt.mana = Math.min(tgt.maxMana, tgt.mana + Math.round(dmg * 0.04));
    fx.push({ k: "hit", t: tgt.uid, tc: { col: tgt.col, row: tgt.row }, magic, amount: dmg });
    if (tgt.hp <= 0) {
      tgt.hp = 0; occ.delete(key(tgt));
      fx.push({ k: "death", tc: { col: tgt.col, row: tgt.row } });
      if (src && src.ppHeal) { const h = Math.round(tgt.maxHp * src.ppHeal); friends(src).forEach((a) => (a.hp = Math.min(a.maxHp, a.hp + h))); }
    }
    return dmg;
  };
  const cast = (u) => {
    fx.push({ k: "cast", sc: { col: u.col, row: u.row }, name: u.ability, ink: CLASSES[u.cls].ink });
    const T = u.aType;
    const sfx = (c, key) => fx.push({ k: "sfx", key, tc: { col: c.col, row: c.row } });
    if (T === "nuke") { const g = lowest(u); if (g) { sfx(g, "nuke"); damage(u, g, 230 + u.magic * 1.9, true); } }
    else if (T === "aoe") foes(u).forEach((e) => { sfx(e, "aoe"); damage(u, e, 95 + u.magic * 0.95, true); });
    else if (T === "aoe_phys") foes(u).forEach((e) => { sfx(e, "storm"); damage(u, e, 60 + u.ad * 0.85, false); });
    else if (T === "multi") foes(u).slice().sort((a, b) => a.hp - b.hp).slice(0, 3).forEach((e) => { sfx(e, "multi"); damage(u, e, 130 + u.magic * 1.15, true); });
    else if (T === "execute") { const g = lowest(u); if (g) { sfx(g, "execute"); if (g.hp / g.maxHp < 0.30) damage(u, g, g.hp + 9e4, false); else damage(u, g, 200 + u.ad * 1.3, false); u.hp = Math.min(u.maxHp, u.hp + 110); } }
    else if (T === "heal_team") { const amt = Math.round(140 + u.magic * 1.3); friends(u).forEach((a) => { a.hp = Math.min(a.maxHp, a.hp + amt); sfx(a, "heal"); }); }
    else if (T === "shield_self") { u.shield += 340; sfx(u, "shield"); }
    else if (T === "shield_team") friends(u).forEach((a) => { a.shield += 150; sfx(a, "shield"); });
    else if (T === "evade") { u.dodge = Math.min(0.75, u.dodge + 0.35); u.as += 0.45; sfx(u, "evade"); }
  };

  const stepToward = (u, tgt) => {
    const cur = hexDist(u, tgt);
    let best = null, bd = 1e9;
    for (const n of neighbors(u.col, u.row)) {
      if (occ.has(key(n))) continue;
      if (u.prev && n.col === u.prev.col && n.row === u.prev.row) continue; // no immediate backtrack
      const d = hexDist(n, tgt);
      if (d < bd || (d === bd && best && (n.row < best.row || (n.row === best.row && n.col < best.col)))) { bd = d; best = n; }
    }
    // take the step only if it gets us closer OR sideways (to route around a jam); never walk backwards
    return best && bd <= cur ? best : null;
  };

  const tick = 0.15, OVERTIME = 16, tMax = 60;
  const record = () => {
    const pos = {}, hp = {}, sh = {}, dead = {}, mp = {};
    units.forEach((u) => { pos[u.uid] = { col: u.col, row: u.row }; hp[u.uid] = Math.max(0, Math.round(u.hp)); sh[u.uid] = Math.round(u.shield); dead[u.uid] = u.hp <= 0; mp[u.uid] = u.maxMana ? Math.min(1, u.mana / u.maxMana) : 0; });
    frames.push({ pos, hp, sh, dead, mp, fx });
    fx = [];
  };
  record();

  let t = 0, winner = null;
  while (t < tMax) {
    t += tick;
    // overtime: when the clock runs out, every unit attacks 5x faster (and closes faster) until a side is wiped
    const frenzy = t >= OVERTIME;
    const asMult = frenzy ? 5 : 1;
    const moveMult = frenzy ? 3 : 1;
    // deep-overtime finisher: true damage that bypasses armor/shields, in case 5x attack
    // speed alone can't break a heal/shield stalemate. Rarely reached.
    if (t >= OVERTIME + 10) {
      const bp = 0.025 * (1 + (t - (OVERTIME + 10)) * 0.3);
      for (const u of units) { if (u.hp <= 0) continue; u.hp -= u.maxHp * bp; if (u.hp <= 0) { u.hp = 0; occ.delete(key(u)); fx.push({ k: "death", tc: { col: u.col, row: u.row } }); } }
    }
    // act in a seeded-shuffled order so neither side gets a systematic first-strike edge
    const order = units.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
    for (const u of order) {
      if (u.hp <= 0) continue;
      if (!u.target || byUid[u.target].hp <= 0) { const tg = pickTarget(u); u.target = tg ? tg.uid : null; u.stuck = 0; }
      if (!u.target) continue;
      const tg = byUid[u.target];
      const d = hexDist(u, tg);
      if (d <= u.range) {
        u.stuck = 0;
        u.atkTimer -= tick;
        if (u.atkTimer <= 0) {
          u.atkTimer = 1 / Math.max(0.2, u.as * asMult);
          if (u.range > 1) fx.push({ k: "shot", sc: { col: u.col, row: u.row }, tc: { col: tg.col, row: tg.row }, ink: CLASSES[u.cls].ink });
          else fx.push({ k: "melee", sc: { col: u.col, row: u.row }, tc: { col: tg.col, row: tg.row } });
          damage(u, tg, u.ad, false);
          u.mana = Math.min(u.maxMana, u.mana + 12);
          if (u.mana >= u.maxMana && u.hp > 0) { u.mana = 0; cast(u); }
        }
      } else {
        u.moveTimer -= tick;
        if (u.moveTimer <= 0) {
          const step = stepToward(u, tg);
          if (step) {
            const closer = hexDist(step, tg) < d;
            u.prev = { col: u.col, row: u.row };
            occ.delete(key(u)); u.col = step.col; u.row = step.row; occ.set(key(u), u.uid);
            u.moveTimer = u.moveCd / moveMult; u.stuck = closer ? 0 : (u.stuck || 0) + 1;
          } else { u.stuck = (u.stuck || 0) + 1; }
          // melee jammed against a saturated foe: peel off toward a different reachable enemy
          if (u.range === 1 && u.stuck >= 4) { const alt = pickTarget(u, u.target); if (alt) { u.target = alt.uid; u.stuck = 0; } }
        }
      }
    }
    record();
    if (!living("A").length || !living("B").length) break;
  }
  const a = living("A").length, b = living("B").length;
  if (a && !b) winner = "A"; else if (b && !a) winner = "B";
  else { const ha = living("A").reduce((s, u) => s + u.hp, 0), hb = living("B").reduce((s, u) => s + u.hp, 0); winner = a !== b ? (a > b ? "A" : "B") : ha >= hb ? "A" : "B"; }

  return { winner, frames, meta: units.map((u) => ({ uid: u.uid, heroId: u.heroId, name: u.name, side: u.side, star: u.star, maxHp: u.maxHp })), survivorsA: a, survivorsB: b };
}

/* ---------- economy generators ---------- */
const ODDS = { 3: [60, 30, 10, 0, 0], 4: [45, 33, 18, 4, 0], 5: [33, 35, 25, 6, 1], 6: [25, 35, 30, 8, 2], 7: [19, 30, 33, 15, 3], 8: [15, 25, 35, 20, 5], 9: [10, 20, 33, 27, 10] };
const XP_FOR_NEXT = { 3: 6, 4: 10, 5: 16, 6: 24, 7: 36, 8: 50, 9: Infinity };
const MAX_ROUND = 15;
function rollShop(level, rng) {
  const odds = ODDS[Math.min(9, level)] || ODDS[9]; const out = [];
  for (let i = 0; i < 5; i++) {
    let r = rng() * 100, tier = 1;
    for (let c = 0; c < 5; c++) { if (r < odds[c]) { tier = c + 1; break; } r -= odds[c]; }
    const pool = HEROES.filter((h) => h.cost === tier);
    out.push(pool.length ? pool[Math.floor(rng() * pool.length)].id : null);
  }
  return out;
}
function assignEnemyCells(list) {
  const order = { tank: 0, fighter: 1, assassin: 2, support: 3, mage: 4 };
  const sorted = list.slice().sort((a, b) => order[HERO[a.heroId].cls] - order[HERO[b.heroId].cls]);
  const rowsByFront = [2, 1, 0], colsOrder = [3, 2, 4, 1, 5, 0, 6], cells = [];
  rowsByFront.forEach((row) => colsOrder.forEach((col) => cells.push({ col, row })));
  return sorted.map((p, i) => ({ ...p, col: cells[i].col, row: cells[i].row }));
}
function makeOpponent(round, rng) {
  const isCreep = round % 3 === 1; const power = Math.min(1, (round - 1) / 14); let board;
  if (isCreep) {
    const size = Math.min(5, 2 + Math.floor(round / 3));
    const tanks = ["bes", "sobek", "osiris"], grunts = ["ammit", "khonsu", "horus", "apep"];
    board = []; for (let i = 0; i < size; i++) { const pool = i < 2 ? tanks : grunts; board.push({ heroId: pool[Math.floor(rng() * pool.length)], star: 1 }); }
    return { board: assignEnemyCells(board), isCreep: true, name: "Tomb Guardians" };
  }
  const cap = Math.min(8, 2 + Math.floor(round / 2));
  const favored = Object.keys(ORIGINS)[Math.floor(rng() * 4)];
  board = []; let g = 0;
  while (board.length < cap && g++ < 200) {
    const fav = HEROES.filter((h) => h.origin === favored);
    const pool = rng() < 0.55 && fav.length ? fav : HEROES;
    const h = pool[Math.floor(rng() * pool.length)];
    if (h.cost > 1 + Math.round(power * 4) && rng() > 0.3) continue;
    const star = rng() < power * 0.55 ? (rng() < power * 0.4 ? 3 : 2) : 1;
    board.push({ heroId: h.id, star });
  }
  return { board: assignEnemyCells(board), isCreep: false, name: "A Rival Court" };
}

/* ============================================================
   PALETTE / TYPE
   ============================================================ */
const C = { paper: "#e7dec6", paper2: "#ded2b4", ink: "#211c12", ink2: "#5b5340", lapis: "#1f5673", blood: "#a8331f", ochre: "#b8923a", mend: "#3f7a63", line: "#a89a78" };
const COST_INK = { 1: "#6b6450", 2: "#3f7a63", 3: "#1f5673", 4: "#5a4170", 5: "#b8923a" };
const FONTS = (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=IM+Fell+English+SC&family=IM+Fell+English:ital@0;1&family=Spectral:ital,wght@0,400;0,500;0,600&family=DM+Mono:wght@400;500&display=swap');
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    @keyframes flick { 0%,100%{opacity:1} 50%{opacity:.55} }
    @keyframes rise { from{transform:translateY(6px);opacity:0} to{transform:translateY(0);opacity:1} }
    @keyframes dmgfloat { 0%{transform:translate(-50%,0);opacity:1} 100%{transform:translate(-50%,-22px);opacity:0} }
    @keyframes shot { 0%{opacity:0} 25%{opacity:1} 100%{opacity:0} }
    @keyframes ringpop { 0%{transform:translate(-50%,-50%) scale(.3);opacity:.9} 100%{transform:translate(-50%,-50%) scale(1.5);opacity:0} }
    @keyframes sfxpop { 0%{transform:scale(.35);opacity:.15} 22%{transform:scale(1.15);opacity:1} 100%{transform:scale(1.45);opacity:0} }
    @keyframes sfxpopspin { 0%{transform:scale(.35) rotate(0);opacity:.15} 22%{transform:scale(1.15) rotate(45deg);opacity:1} 100%{transform:scale(1.45) rotate(160deg);opacity:0} }
    ::-webkit-scrollbar { width:6px; height:6px; } ::-webkit-scrollbar-thumb { background:${C.line}; }
  `}</style>
);
const DISPLAY = "'IM Fell English SC', serif";
const SERIF = "'IM Fell English','Spectral',serif";
const BODY = "'Spectral',serif";
const MONO = "'DM Mono',monospace";
const GRAIN = { backgroundColor: C.paper, backgroundImage: "radial-gradient(circle at 20% 30%, #00000008 0.5px, transparent 1px),radial-gradient(circle at 70% 60%, #00000008 0.5px, transparent 1px)", backgroundSize: "7px 7px, 11px 11px" };
const press = (color = C.ink, off = 3) => ({ border: `1.5px solid ${C.ink}`, boxShadow: `${off}px ${off}px 0 ${color}`, background: C.paper });
const HEXCLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";
const FX_SPRITES = {"nuke": {"uri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAEMElEQVR42u2ZPWxbVRiG33Ovr33jn4jaIikZkBKpFUVloEFI/ImBDlkQQ8QAEWoHJLwQIbkTWSyGbmEgQ6nEwMBPJzrAkAFFCCW0StKEYFEgUU1b2iAZxyQ4du1c+7wMja9sxzZu8LXj5jySh3NlH5/vPd95z3fOBRQKhUKhUCgUCoVC0RkCb8yxU/+tHXbxtcM+igMhQDFgHG4BCiHP4RbAOuqFfv76Axmh/+wVPjQCPHbEDbPPbH7XGJvj9qfPiYdGAI9LoM/vajr49OcviK5YAtVpWi9tQz4XQj5X24NvC9VBe84t0z2xUvHspek/OTKTsJ/1jF9jreC70gSlqVcEZA14YQwGKr5ztNfAayd7AQBiao33PhqumGVveJ40urhmMyNLFbM+MpPg4KXbdvuLtMUFSQLAM1+vV8y0e2KFZmSJ6HbcEyv0fRInAFxI5HghkSMAzEpylZJ3KXlVkuOxLTtYIxrbs1xaTVsNRUyt8dzpfrxyPIAhjcgDeKRsHWYA3KbAaU0I4+INyo08iu8/KWp5wYEzw8DYHJs51YV/3ORPuzNe6zNdJKPxbZ68fIfVPtCq4sfRDLBF0GrPUjS+zdFBL4J1fp8BEJcCI7oQJf8QFlFtjF2xBErpSkNDqXKbLpLHNaJe9V8AsAXgq9+z+ODyHcjIE46O0eVk5+UZYEaWGHw6dN/cmhhQKlN0PHjHBSgnN3lKrAMw3yQb7egSQJ4CQZ/elnE5LoAZWaIVMvHicBDvPB9Cv2DD4K2y9sBnt5j8ZRN6ugCxU7Sf062DRu3kEBYhdorQckU0c2BqSoCS+5Y6LF/b0tQha9TxFAL0aLB8Bh4f8uNEv4k+nwsesGFZWgBQBBAd8rdlm2vbXnpmIcW3ho/gmGBD1SWAv3dN8Juf/8HiqwOOjrEtBbb24W+8mdpBgc0PyGto8Lk1GBdvOFoNOqquNzxPunUUgm5Y0acEACxIcqCBD6QArOaI0R5dlMRzbeSgpwuO1AKOCFCvXB2ZSfC9lx/FCe3+MpBVKbhOgcVkHpeWN7H4RxaZt4f2lsESSH95QO8EGpWq+vnr9glwVpKzkpwukrcouUrJ73ZPg+W7R71TYCdfpOwLIxpj+aXn6z8keWYhZYvxraTdLqdn/BprXY50XfBGNGYHoU3+SjG1ZrfHY1uMxrfrBum0CJrTwQOwDRAA3OtZ8N1jdnv5bhZXb2br9lEyPqdE0NoZvDc8z9zkqQoDu2cRyUyhYV8lEbzheXaFAKV9uzx4AMh+/Owe997IFLDxHwKUi9DqO4GWC1By7urgW0EtAQ/UYch/9gplpoDqNG84s5Z8oP9o1RuhlgsQGJtjeh+DS/yV7+gu5WrVzKf3OTPGehaCRK6bBfg/aWkkcxCW7JgAHad39PuOVnodf99Etw6FQqFQKBQKhUKhULSZfwEVsBMM6B7iPgAAAABJRU5ErkJggg==", "spin": false}, "aoe": {"uri": "data:image/png;base64,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", "spin": true}, "storm": {"uri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAOOklEQVR42u1be2xU15n/nXPfd+6Mx4PHDzBgXikhJCmb0AdpUKgUS5uVoDQy4SGBoEIJbLfbpFLE8sdmH1IUrbS72m43UbVKEEg0CShJQ6VsBVLT0l0W4VASxfE6bXgEHDu2x+M7r/u+99s/Bg84YHvGL7TbfJIlazz3nnO+8zvf9/1+3zHwpX1pf9TG7tTAXRu30bykhjAkDI1YWPPO6+yPxgGd7R20cGECiQfiEHQB9lUH2a4Clh47MufzEed6wNPrN5PvR7AKPvR8CPXeOKRVBrRFKvrVPXStv4CvnTrO/t8fgVEL3nyW2Jp6sKwL970ccufyMLMOgjBC1nSw/vRbszpHfqcdUOwqgY14gMQhpSXoK3SkmnRwxiAK/P8OAi5t2UkApnSOgzefJZ5WEA258D73kD9fQPPLL88JOmfExb07dlPTt+rR8NUEujZuo1qezR7YR84VB/aFPMJiCEEXQD7NGQKn5IALjz1RmWH3pu1kLNcgJkVEAWH1iVer3rnBp/aSMl+G9Xu7jAQzAFP4nEammrJA96bt1LAgBikpIrPySQpyAcSECGmeBAAgJ6p5AhSUfVnqthBbpYPcCKgBAGc2PE5LFtUh9hUdQT5E6oWX2KwhINWgQV+uQW6WobWpMO6JQVuiQkyKkNMytGUa+nfuqXr6n14yMXjWhGV6FWf4WR+uF1Y9p3XvvsGYyKCv0JF8qA6D+/fSrDjg3KMdBADWJzZKPRbsyw4ijyAmyyAK7RDKIhXJh+rQu2N3VZNYe/I4W3rsCGt77TCL/AhMZAiKIYqWVxOKml9+mQX5AMwQIKel2TkCQRChv7+IIIiw9uSNQsX+6dPENY7iB0VI8yQorQqSD8TRXdxOq97+WdVwVFsV6HfH4PW70Lukmo9SWCqjhit8doJgEEbIFdwxix81aVkM2jINFBDCYggpJaFxaXxMsJzM9JUxRMvjkJbFoMelKQc1wRBmBwHjVWRc46B5CiQAiErlSC4yyE0yFiKJbqk6JIiLNJDCwfI+giqCaWd7B2mqCD+IkK7XIcTKC1daFHz+ve9RtXXEtOsAq8cCIgLiIuzLNmI/+BeWP19A5EXQlqhINWiTp8P9ewkRgX+Uw/CpLFqPHmLVkKmGtI6WFgOCwCrZRGgoV5NzRobqn3+JDZrlyNv44r+z0aA0uH8vSUkRXOKTBleucBT/y4T1B6vqCvDm94ZBiMiNEI74QAgozTIG9++lTz8xb3tkZ5wNji58TI2fcSGbMiJ/Yjg3ztMBBmTfz6PttcNVLX7tyePs0padVL88Bj8bQFumISyGMH+bQ2RH4BqHmBChqeLsI2Dco+H4qHciiHXjD9G/cw+lvl2P0ApR7HNqev/SY0dY8Z9+QLF7DYT5AOaZHFoOv8JuFlxsJ7izdNj8uz8nbZGK3Ln8bVFivfhDUh5pABt2wR/++6rn0tneQYuXJlG3LgE5LSPXmUfyr/9tSmuZVUGEnAjSihgaVhmI/vQAFT8qIXHgX9kogdJW6IiSEkgTELz5LPUeG5jwGHS2d1BMk1CfVKEuUkA+ofBBEWZ3cXa4wJkNj9O6d9+YMkqcz1zURYSoLQ7clYD+9XkI7nqWxO/+A9MXqiD9+vAKB1+sw5iv3kK6WloMqK3lxYZ2hMiOAA4E+RDO1QIy/SXUUnBV7YDuTdtJVaYHkJbDrzB3w49IWBEvfyBzsJUJWC/+kLjCAU0AAgJEBtJEGPfExux08911MO43wBUG6/c23AELVsGH4waIegmWHUxbPhMnIj5yWh4XipOll1HLnc0jvUBBtEAHCyIg50Osl8AVBhABYdkBMETI98ZR+vFfUqnHAlc4lPkyyI9Q7LGR/NsXZyVejesArnDIjRKyB/ZRkA+AqFw2jdba/S17yLYDDJv2hLl2sK8I+T8laMtcCIYALnGIhgAmMiB7nQWm1TIK6mXoK3T4ZgByyuTI7fNmbfHjZoHO9g5ack8K6kIFTCxXWdH18pSrHExk8M0AgRnAGfDQP1Sc2An791JspQ4xKYJJHORG8LM+/IwPISEi/kAc0cIy/Pm1EkofFhHkAnBNgHPVQTUFzYw54PT6zdRQr6FhQQxyWgLXBARmAOtaOU/LcfGW4sYpBRjKWrdMsmvjNtJVCUZKgdwkQawTETkREgd/wr5YDyQejENbkwA4Q9TnwLnmwPrERuaz6QW5mhzwq3WbKG7ISKd0KIoAQRMgpUT4ZnDbPD4arEaD5bBpw/cjrHv3Dda9aTslDAWCwAAGCJoArnMU+5xxU5175EckPlgPZgfw3s9j5DcmWo68MiOLv/DYEySJ/BbJbkwMEEWOmCYhigjDIzYwAiQLKtQmGSMH9xFFgNvnViY1uuPnHu0gQ5eQTulw3AA9m3eQoZcDaBiWSYqddZG76k7YAnN7XYjfZCAugesCmMTQ2d5BthNMuz+w5BsNkJIicKIKNjhs2lh94lW2+sSrrPXoIeYMeBAMAbGVOgT9Vr79tVPHWWbExkjegSwJGF38GC2h6E7a/0sc/AnjV0pgeQ+RFYJLHOmUjoZ6DRcee4Kq0RfObHicTq/fPOZ7V7buImN1DNoDt0pmYxwQEaFk+/hiDd169BDr6xzB0KksBvuK4+oFa955nX0+VIJZcOD5YeUHACRxcuZ9actOsv6nBO/DAuyLNkIrhChw1NepWLAogbavpibU/Lo3bacli+rQ2hxHZ3tZwuvetJ2SX4mBpxUwr8waJwyCv374OxSFhG+feXtakDu9fjNpqoiYJiFhKBBVDqvgT9g4ubJ1FyVXGUBI8AZ8eIUbGyHXiTBWxyA3l2X021Fn87n9JNaJ8AZ9BGYAcEBKilBaFQiGAPvirfXEbSfz64e/Q4/89uczEnx6Nu+gZEqF0iSDImDw4zxWvnX0tu/OP/99UloVhMUQ3oAH+7ID2wnguAFURYSRUmDcF4O6UK2kZ3/ER2RHkNIS+GIdLO+j8N+5MfJYWAxR+tgawxbnhA1e2bqL9JQMuVmG3CBVAp3T62Ik51TS2+BTe8m4LwZtiQaoHHAiFD4oIvO7HDIjNhz3RhC8tGUnNfxJHYyHkqBmFbh+tKj+etxxQvCrJUSf2vCGPFBAsC87aPjnn7I5ZYOjcFYXKJAbZTCjXPcLugC5WUYCceS//n0SDAFKqwKeVkCcVXZF0Pltj8vSY0dYt7ud5nsR6tYmQAkJ1KjcJC8LoIQMCPaNIJwP5p4OGy1l2CvzFdACDVFcAhvxIBQChFaI0YULcRGkCgC/sVYSy4rOla276HY1w6q3f8bwdplSy3ERapsK/S4NgibAG/Lg9rrwMj4ElUMwJu41ijNxxg1dhiAwhCEhCCOoMRFi/U2v9iOwEQ8s55XPd8YHBjwo8xVwiVfOYcURvKwq6yl5wrEnE097d+wmY7k2e4JI5pknKfnNOggNEuBE8IY8+JlyjR9ZUaWDxBWGyCWkXniJjZKr0XRU4RpuVDkKlciflqa1OWbBgTwgYiJpbMpBMPP0k5T6biNocQwICazPhtdTRP58AcWMOy5L7N2xm+Q6EZFb1gu5zCvV5cjBfaTfpVcqFLfXxdWzwzV1nGul7lNCQPem7RS/3yhH4ZDAe/LIdeZhdherUnbj9xvgGofb5yH/YbEC5c+6TBiXLLS9dphlD+wjrjBwNr1ENW1ZvGvjNrp5BzrbOyjVoAEcYIMu/IslKDv/sepZth49xKJn/oaoRYP8gYnM73KVv908jnmpBCOlIKLZvSzBJ0tlbY+kYT63vzKLJatTUJpkuH0e7PO5mhZfifItWkUPHK8yHDbtMZXgHXEAAKhtKhJ/lgadOkj0H39FibUJMImBywz+sF/TfQAAiH5xgEgXwUY85M7mxv2e70fw/DIX+CK5mTMHtL12mBXeK4CVAlCTCkpI4CKr3AhRF6nQlmtV3wsyn9tPWKCBXy3Bfqu/KqnL0OVbOjw9m3fQnCGg/vmX2PAvMvDfzyG4aleqKq5yMKF69GeefpKM+w2wAQf5nw/AeObHEz4chFGFScZjcuWCxuBTe2nhhgYMPrV3RpxQVRa41mNiIQFyk4zIixCYAfxhH2FAyBfdSdNU18ZtpC4sFz3WHyx8fsGcdMz1p99i5x7toFF9QZYE9O7YTVznCIshuDYzdwir3sJLW3aS0aAgciNkhqyac3P2wD7SlqgofWzh0ofZqvX8zvYOmpfUIEtlZuf5IfS4BKvgIzNij3nP6fWbqVblqGo3Dps2wmIIq+AjX/Bq9rTb58L51IEz4NXUzFh78jgbNm0EYQRBZOCcwcw6cNwA0hda73FDrjlgVl0I+X75isxUTZonQW6WEU7hKt3ak8dZ18ZtlGhLIt4owc/4cAe8iuQupyVwhcPL+LjclcWsIMALQmRNB7YbVESTWgZKrquD2t6I1ONNyL/wF3Rl666anl994lUWuRH0FTriD8ahLlahtiqo+0YCdd9KIr4mXrmxNisIGFWIfrVuEwEAF2qrf/iyGKJmFdSswtAESPUieoXdNBmjG5MZ8gGYysFTMsQrDpxrLuyLNvyMX75e97FVcwOlZpdNVSusKDbXf2ciq6S5ak1pkkG6CJb3UfyohGvX8tPuGM3ZP0yQdpOcboewL9o13Sy/8NgTxFQO/2IJubP5GbtNPqsO6Nq4jRpbDaQ3pxGqZQcwKwAbduGbtdX5a955nXWJ24ifZzPaKps1B3S2d1BDWkdsZZnfsz673B4vBGBOCLlZrvmd09EFZlwQqRYBybgKUeUV8UNulBC7OwYKCPn38rPa+r7jDhhPp0s/moJ0XwIIIgQXLQz/chiXr+Ywnes4s0aGZtpajx5iuXN5sAEHGE2lhDuy+Dtq/bv2UK13+7+0L+1Lm3H7Xy0+o/ncXtJ0AAAAAElFTkSuQmCC", "spin": true}, "multi": {"uri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAEFklEQVR42u3ZXYgVZRzH8e8zr2fmvHj27JtbrspuIXVhGl1IQRIRLBJhL+wqkm6tYHsjVlCCUXQTiFjdlAkmKUUiBF14UYQgFORFrRS9aC+may+763F33eN52T0z8+/i6Krs2egiz3bW5wPnZmZg5vnN//nPzHNA0zRN0zRN0zRN0zRN02rm89WPyVxfgzGXJ497Fjd1AJm0x8lHN1StgoGubjn+4BNS1wEMb+6T7LNbZh2El7BIJZwZ2799eJ1k0h6ObdR3BZhJi+RdCUae2Vw1BOUYmO7MS1i4OIljG9z9yWFV1wE0vbFXFX8r4nV6nFm3Sf5NxRT2bBP/dp+Luan50QPSr76tlGXQsrqB4c190yGcWNMjRszATF1thC09rcTuyxDmQ+74+ANViwBq0oYliIitasK7zSeb2iJNr+9VC5vjuG0O7qIYcnSHRO0+YdrBOJen8HOhZo24JgEUfy0SvzckWpYi41tMrnheAKyUhVriE97qg1W54XKuSNuB/aouAzixpkdaG32UoShPRSz+8D0F0PLOPhV2vSi0eUi7j9XsokohlCNkgTM9+LlwQ848tqNfrIxNOBFQPFPCztg0rmkk6kwinlk5cTGEIIKYiSSu3gd1YZLwq3GC8TJum4tq9xDPgl9yjHx0/j+vjhsW/eD6XrEdAztjk1yZwLqnAWlyKztDQZUjCAQshcTM66sgkMoxl0MyzuZRD72m6qYCrnW6e6O0P96KeqBl9kFWCUFlJ5k8eh6//01Vd1OgmmBkl1Sb6+pSAJMhkrDhyktRIKjjWcxHdqq6aoKzKezZNutLkNgGxvgU6lKAuJf7QxAhEWSf2yITvxfpOHxQ1WUAA13dsrA5jp2xIZTq3d5USNqBUlh5MuQCVCkkKEYkVySItccYTvVJ675366cH/Lh2gyxIOlhJC6fZxl3k4i5LIEvj13X8mfNEMP4oUDg2SmmwhOEaOK2Vj6UgF5B++S31vw5goKtb0qkY8ZQNQFQWJBKsuIm/LI5/fwNRe/wfn/vG2TzGyleuO+CvTU+LGTeRqYjhoTzLjxxSddcEc7u3SnxVGmlxwTVnrQQ1VMK886WaXVfNFkT8Tg9pcOD7CczF25X59ShqvFx5HE5GlR9AzGR0e7/MqwByu7eKWuLDTzmyR7IADL0/RPBFFvObMcJPh7HaXlDy2TDq4hR2sz2/lsTcW1yCk5cw1+5UV7p524H9Kv9Dgfx3eS4cHQXA7tmlCsdGsVImg+t7a1IFNfsazJ/Kz9hezlYWPbJjxeltI1+O0bg8RbLDY14YXN8rs60Gne7eKH8++VTVfbXqAzd8CmTHCiw9dKBqV+84fFBde/evNXJqgpvCQFf3nP45Ysx1APligKZpmqZpmqZpmqZpmqZpNfM38gN3zKBtqK0AAAAASUVORK5CYII=", "spin": true}, "execute": {"uri": "data:image/png;base64,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", "spin": false}, "heal": {"uri": "data:image/png;base64,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", "spin": false}, "shield": {"uri": "data:image/png;base64,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", "spin": false}, "evade": {"uri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAEhklEQVR42u3Xv2/TaBjA8W9au45x86ZuU5eCU6C0AwNSd/4TpA4dKlWoQwYkRsTOwFiJAQkkJAYG/g/UBQmpBVUiDm4bkyZx/COuE/uGUy0Y7o7eUdDdvR/JixO/fp/31/MYJEmSJEmSJEmSJEmSJEmSJEmS/idKP/NljUYjr1arTExMcHh4iO/7vHz5svSfGYC7d+/mlmWxvLxMvV5nenqaLMtI05Q0TVFVFYA0TXEch06nQ5ZlKIoCQBzHdDodfN/n1atXRd/W19dzwzAYj8ckScLz589Lv3QA7t+/ny8tLaFpGr1eD8/z6Pf7GIbBrVu3WFtbo16vI4QoAvN9nyRJGAwGOI6D67p0u10AyuUyAFEU4XkeaZpiGAbXr19nfn4ewzBQFIV+v0+r1cJxHMIwLPqTJMnfXknKeR/Y3t7O79y5w9raGpqm4TgOu7u77O3tfRNsHMfFjAdBQKfTodls4rouruvS6/WIoojJyUl0XSfLMqIoYjQaoWka1WqVhYUFlpeXqVQqJElStAUwHo8xTRMhBEEQsLq6mj969Kh0oQOwsbGR1+t1bt68ycLCAlmWMTU1he/79Pt9oiji5OSEVqvF/Pw8mqYVM3Q2u4PBgBcvXvxlRzc3N/NLly4BoKoqnU6HXq9HEATous61a9dYXV3Ftm1UVaXVamGaZt5oNEoXMgCbm5u5bdvYtk0cxxwfH3N6esr79+958ODBDz/Inj59+odtbm1t5XNzc5TLZYQQ6LqOYRiEYUij0cifPHny3f2Z+N4/2rbNysoKmqbhui77+/vs7u7y7t27n35y7+zslMIw5Pj4mDiOGY/HKIrC7OwspmlezBZQVRVN05icnCSKomJJdzqdX5K+0jTly5cvHBwcUKvV0HWdk5MT4jg+VzvfvQLa7Tau6xJFEZqmfXOtr6/nPzP4hw8f5pZloaoqjuPw8eNHDg4O+PDhw7kn5Fx7d2trK19cXGRlZYVqtUqapnz69IkkSZiZmUEIQblcRlVVrl69yo0bN1AUBc/z2N/fZ29vD9d1CYKALMsQQmCa5jfPTk9PI4SgVCrRbDZ5+/YtruuSJAmapnHlyhVu376NZVkEQUC73S4O2mazyePHj0sXlgV2dnZKGxsbOcDS0hIAuq5j2zb1ep2ZmZkiRem6XhRAmqYVvx8eHhbLdHZ2lsXFRWq1WpFCz4LxPI8kSYo0F4Yhuq5jWRbVarWoG46Ojuh2u4Rh+KcH5w+rA549e1YCuHfvXj41NUWlUiGO46KaS9OUXq/HaDTCMAyEEFQqlSIlAvi+D0CtVqNWqyGEII5jBoNBUVgNh8Mi539dKbquy8TE7zv36OiIz58/E0URr1+//luZ6Ielr0ajkZfLZUajEVEUASCE4PLly1SrVUzTRFEUBoMBnucBMDc3h2VZCCHo9Xq4rku73WY4HAIwGo3odrv4vk8YhoxGIxRF4aw++CeB//SPoe3t7VxRFE5PTwmCgDzPKZfLRZl7ZjgcFmXz1/fevHnzSz+aJEmSJEmSJEmSJEmSJEmSJEmS/vV+AwiUMt97yjpiAAAAAElFTkSuQmCC", "spin": false}};

function Tile({ heroId, star, size = 48, dim, selected, showCost, onClick }) {
  const h = HERO[heroId]; const oInk = ORIGINS[h.origin].ink;
  return (
    <div onClick={onClick} style={{ width: size, height: size, position: "relative", cursor: onClick ? "pointer" : "default",
      background: C.paper, border: `1.5px solid ${selected ? C.blood : C.ink}`, boxShadow: selected ? `2px 2px 0 ${C.blood}` : "1px 1px 0 #0003",
      opacity: dim ? 0.6 : 1, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ height: 5, background: oInk }} />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: DISPLAY, fontSize: size * 0.3, color: C.ink }}>{h.name.slice(0, 2)}</span>
      </div>
      {star > 1 && <div style={{ position: "absolute", top: 5, right: 2, fontSize: 9, color: C.ochre, letterSpacing: -1 }}>{"★".repeat(star)}</div>}
      {showCost && <div style={{ position: "absolute", bottom: 1, left: 0, right: 0, textAlign: "center", fontFamily: MONO, fontSize: 9, color: COST_INK[h.cost] }}>{"◈".repeat(h.cost)}</div>}
    </div>
  );
}

/* ============================================================
   HEX FIELD
   ============================================================ */
function Field({ children, onCellTap, highlightHalf }) {
  const cells = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) cells.push({ col, row });
  return (
    <div style={{ position: "relative", width: BW, height: BH, margin: "0 auto" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: cy(MID) - ROWH / 2, height: 1, background: C.ink, opacity: 0.4 }} />
      {cells.map((c) => {
        const mine = c.row >= MID; const interactive = onCellTap && mine;
        return (
          <div key={key(c)} onClick={interactive ? () => onCellTap(c) : undefined}
            style={{ position: "absolute", left: cx(c.col, c.row) - HEXW / 2, top: cy(c.row) - SIZE, width: HEXW, height: SIZE * 2,
              clipPath: HEXCLIP, cursor: interactive ? "pointer" : "default",
              background: highlightHalf && mine ? "#a8331f12" : mine ? "#0000000a" : "#00000005", transition: "background .15s" }}>
            <div style={{ position: "absolute", inset: 1.5, clipPath: HEXCLIP, background: C.paper }} />
          </div>
        );
      })}
      {children}
    </div>
  );
}

function Token({ meta, pos, hp, sh, mp, dead, selected, flash, ghost, onClick }) {
  const h = HERO[meta.heroId]; const oInk = ORIGINS[h.origin].ink;
  const pctHp = Math.max(0, Math.min(100, (hp / meta.maxHp) * 100));
  const pctSh = Math.max(0, Math.min(100 - pctHp, (sh / meta.maxHp) * 100));
  return (
    <div onClick={onClick} style={{ position: "absolute", width: TOK, height: TOK, left: cx(pos.col, pos.row) - TOK / 2, top: cy(pos.row) - TOK / 2,
      transition: "left .14s linear, top .14s linear, transform .1s", zIndex: dead ? 1 : 5, transform: flash ? "translateY(-3px) scale(1.06)" : "none", cursor: onClick ? "pointer" : "default", opacity: ghost ? 0.55 : 1 }}>
      <div style={{ width: "100%", height: "100%", clipPath: HEXCLIP, position: "relative", background: meta.side === "A" ? "#cfe0d2" : "#e9cdc6",
        boxShadow: selected ? `0 0 0 2px ${C.blood}` : "none", opacity: dead ? 0.28 : 1, filter: dead ? "grayscale(1)" : "none" }}>
        <div style={{ position: "absolute", inset: 1.5, clipPath: HEXCLIP, background: C.paper, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          <div style={{ position: "absolute", top: 4, left: 0, right: 0, height: 4, background: oInk, clipPath: "polygon(50% 0,100% 100%,0 100%)", width: 8, margin: "0 auto" }} />
          <span style={{ fontFamily: DISPLAY, fontSize: TOK * 0.3, color: C.ink, lineHeight: 1 }}>{h.name.slice(0, 2)}</span>
          {meta.star > 1 && <span style={{ fontSize: 7, color: C.ochre, letterSpacing: -1 }}>{"★".repeat(meta.star)}</span>}
        </div>
        {flash && <div style={{ position: "absolute", inset: 0, clipPath: HEXCLIP, background: flash, mixBlendMode: "multiply", opacity: 0.45 }} />}
        {dead && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: C.blood, fontSize: TOK * 0.5 }}>✕</div>}
      </div>
      {!dead && !ghost && (
        <>
          <div style={{ position: "absolute", bottom: -5, left: TOK * 0.1, width: TOK * 0.8, height: 4, background: C.paper2, border: `1px solid ${C.ink}`, display: "flex" }}>
            <div style={{ width: pctHp + "%", background: meta.side === "A" ? C.mend : C.blood }} />
            <div style={{ width: pctSh + "%", background: C.ochre }} />
          </div>
          <div style={{ position: "absolute", bottom: -9.5, left: TOK * 0.15, width: TOK * 0.7, height: 2.5, background: C.paper2, border: `1px solid ${C.ink}` }}>
            <div style={{ height: "100%", width: ((mp || 0) * 100) + "%", background: C.lapis, transition: "width .12s linear" }} />
          </div>
        </>
      )}
    </div>
  );
}

function Effects({ frame }) {
  if (!frame) return null;
  return (
    <>
      {frame.fx.map((e, i) => {
        if (e.k === "shot" || e.k === "melee") {
          const x1 = cx(e.sc.col, e.sc.row), y1 = cy(e.sc.row), x2 = cx(e.tc.col, e.tc.row), y2 = cy(e.tc.row);
          return (
            <svg key={i} style={{ position: "absolute", inset: 0, width: BW, height: BH, pointerEvents: "none", zIndex: 8 }}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={e.k === "shot" ? (e.ink || C.lapis) : C.ink} strokeWidth={e.k === "shot" ? 2 : 3} strokeDasharray={e.k === "shot" ? "3 3" : "none"} style={{ animation: "shot .15s linear" }} opacity={0.8} />
            </svg>
          );
        }
        if (e.k === "cast") return <div key={i} style={{ position: "absolute", left: cx(e.sc.col, e.sc.row), top: cy(e.sc.row) - TOK / 2 - 10, transform: "translateX(-50%)", fontFamily: SERIF, fontStyle: "italic", fontSize: 11, color: e.ink, zIndex: 9, whiteSpace: "nowrap", textShadow: `0 0 3px ${C.paper}, 0 0 3px ${C.paper}` }}>{e.name}</div>;
        if (e.k === "hit") return (
          <React.Fragment key={i}>
            <div style={{ position: "absolute", left: cx(e.tc.col, e.tc.row), top: cy(e.tc.row), width: TOK * 0.7, height: TOK * 0.7, transform: "translate(-50%,-50%)", borderRadius: "50%", border: `2px solid ${e.magic ? C.lapis : C.blood}`, zIndex: 8, animation: "ringpop .25s ease-out", pointerEvents: "none" }} />
            <div style={{ position: "absolute", left: cx(e.tc.col, e.tc.row), top: cy(e.tc.row) - 8, fontFamily: MONO, fontSize: 11, color: e.magic ? C.lapis : C.blood, zIndex: 10, animation: "dmgfloat .5s ease-out forwards", textShadow: `0 0 2px ${C.paper}` }}>{e.amount}</div>
          </React.Fragment>
        );
        if (e.k === "heal" || e.k === "buff") return <div key={i} style={{ position: "absolute", left: cx(e.tc.col, e.tc.row), top: cy(e.tc.row), width: TOK * 0.8, height: TOK * 0.8, transform: "translate(-50%,-50%)", borderRadius: "50%", border: `2px solid ${e.k === "heal" ? C.mend : C.ochre}`, zIndex: 7, animation: "ringpop .3s ease-out", pointerEvents: "none" }} />;
        return null;
      })}
    </>
  );
}

/* ============================================================
   META — account / collection / progression
   collection: { heroId: { star, copies } }   (copies count toward next ★)
   team:       [ { heroId, col, row } ]        (each hero deployable once)
   ============================================================ */
const SAVE = "augur:save:v5";
const PACK_COST = 120, PACK_SIZE = 5, PACK_ODDS = [50, 30, 14, 5, 1];
const UPGRADE_COPIES = 5, MAX_STAR = 4;
const WIN_COINS = 80, PLAY_COINS = 25, WIN_XP = 45, PLAY_XP = 18;
const STARTER_TRIO = ["sobek", "khonsu", "apep"]; // tank · assassin · mage
const teamCap = (lvl) => Math.min(9, lvl + 1);
const xpNeeded = (lvl) => 80 + lvl * 60;
const upgradeCost = (star) => 60 * star;
const starMul = (s) => Math.pow(1.8, (s || 1) - 1);
let RID = 1;

const START = () => ({ account: null, level: 1, xp: 0, coins: 120, collection: {}, team: [], wins: 0, losses: 0, games: 0 });

function rollPack(rng) {
  const out = [];
  for (let i = 0; i < PACK_SIZE; i++) {
    let r = rng() * 100, tier = 1;
    for (let c = 0; c < 5; c++) { if (r < PACK_ODDS[c]) { tier = c + 1; break; } r -= PACK_ODDS[c]; }
    const pool = HEROES.filter((h) => h.cost === tier);
    out.push(pool[Math.floor(rng() * pool.length)].id);
  }
  return out;
}
function makeRival(teamSim, rng, level) {
  const size = Math.max(2, Math.min(8, teamCap(level)));
  const avg = teamSim.length ? teamSim.reduce((s, u) => s + u.star, 0) / teamSim.length : 1;
  const favored = Object.keys(ORIGINS)[Math.floor(rng() * 4)];
  const board = []; let g = 0;
  while (board.length < size && g++ < 200) {
    const fav = HEROES.filter((h) => h.origin === favored);
    const pool = rng() < 0.5 && fav.length ? fav : HEROES;
    const h = pool[Math.floor(rng() * pool.length)];
    let star = Math.round(avg); if (rng() < 0.25) star += 1; if (rng() < 0.2) star -= 1;
    star = Math.max(1, Math.min(3, star));
    board.push({ heroId: h.id, star });
  }
  return assignEnemyCells(board);
}

function SectionRule({ children, action }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.ink}`, paddingBottom: 3, marginBottom: 8 }}><span style={{ fontFamily: DISPLAY, fontSize: 14, letterSpacing: 1 }}>{children}</span>{action}</div>;
}
function Btn({ children, onClick, small, color = C.ink, disabled }) {
  return <button onClick={disabled ? undefined : onClick} style={{ ...press(color, 2), fontFamily: MONO, fontSize: small ? 10 : 12, padding: small ? "5px 9px" : "9px 14px", cursor: disabled ? "default" : "pointer", letterSpacing: 0.5, opacity: disabled ? 0.4 : 1 }}>{children}</button>;
}

/* ============================================================
   ROOT
   ============================================================ */
/* ---------- cloud sync (Cloudflare Pages Functions + D1). Falls back to
   local-only play when no backend is reachable, so the app still works
   as a static deploy or in-preview. ---------- */
const AUTH_KEY = "augur:auth:v1";
async function api(path, body) {
  try {
    const r = await fetch("/api/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, data };
  } catch (e) { return { status: 0, ok: false, offline: true, data: {} }; }
}
function loadAuth() { try { const v = localStorage.getItem(AUTH_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function saveAuth(a) { try { a ? localStorage.setItem(AUTH_KEY, JSON.stringify(a)) : localStorage.removeItem(AUTH_KEY); } catch (e) {} }

export default function AUGUR() {
  const [s, setS] = useState(START);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState("team");
  const [sel, setSel] = useState(null);
  const [battle, setBattle] = useState(null);
  const [reveal, setReveal] = useState(null);
  const [bumpState, setBumpState] = useState("idle");
  const [result, setResult] = useState(null);
  const [inspectHero, setInspectHero] = useState(null);
  const [note, setNote] = useState(null);
  const [auth, setAuth] = useState(null);
  const saveTimer = useRef(null);
  const toast = (m) => { setNote(m); setTimeout(() => setNote(null), 1600); };

  useEffect(() => { (async () => {
    let cache = null;
    try { const r = await window.storage.get(SAVE); if (r && r.value) cache = JSON.parse(r.value); } catch (e) {}
    const a = loadAuth();
    if (a && a.token) {
      const res = await api("load", { name: a.name, token: a.token });
      if (res.ok && res.data.state) { try { setS({ ...START(), ...JSON.parse(res.data.state) }); setAuth(a); setLoaded(true); return; } catch (e) {} }
      if (res.status === 401 || res.status === 404) saveAuth(null); // stale credential
    }
    if (cache && cache.account) setS({ ...START(), ...cache });
    setLoaded(true);
  })(); }, []);
  useEffect(() => {
    if (!loaded) return;
    (async () => { try { await window.storage.set(SAVE, JSON.stringify(s)); } catch (e) {} })();
    if (auth && auth.token && s.account) {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => { api("save", { name: auth.name, token: auth.token, state: JSON.stringify(s) }); }, 700);
    }
  }, [s, loaded, auth]);

  const col = s.collection;
  const owns = (id) => !!col[id];
  const cap = teamCap(s.level);
  const teamUnits = useMemo(() => s.team.filter((t) => col[t.heroId]).map((t) => ({ heroId: t.heroId, star: col[t.heroId].star, col: t.col, row: t.row })), [s.team, col]);
  const teamForSim = teamUnits.map((u) => ({ heroId: u.heroId, star: u.star, col: u.col, row: u.row }));
  const traits = useMemo(() => computeTraits(teamForSim), [s.team, col]);
  const built = useMemo(() => (teamForSim.length ? buildSide(teamForSim, "A") : []), [s.team, col]);
  const trayIds = Object.keys(col).filter((id) => !s.team.find((t) => t.heroId === id));

  // prune any team entry pointing at an unowned hero
  useEffect(() => { if (!loaded || !s.account) return; const valid = s.team.filter((t) => col[t.heroId]); if (valid.length !== s.team.length) setS((p) => ({ ...p, team: valid })); }, [col, loaded]);

  /* onboarding + auth */
  const createAccount = async (name, pin, picks) => {
    const collection = {}; picks.forEach((id) => (collection[id] = { star: 1, copies: 0 }));
    const fresh = { ...START(), account: { name: name.trim() || "Augur" }, collection };
    const res = await api("register", { name: fresh.account.name, pin, state: JSON.stringify(fresh) });
    if (res.ok && res.data.token) { const a = { name: fresh.account.name, token: res.data.token }; saveAuth(a); setAuth(a); setS(fresh); setPage("team"); return { ok: true }; }
    if (res.status === 409) return { error: "taken" };
    // no backend / offline -> local-only account
    setS(fresh); setPage("team"); return { ok: true, offline: true };
  };
  const loginAccount = async (name, pin) => {
    const res = await api("login", { name: name.trim(), pin });
    if (res.ok && res.data.state) { const a = { name: name.trim(), token: res.data.token }; saveAuth(a); setAuth(a); try { setS({ ...START(), ...JSON.parse(res.data.state) }); } catch (e) {} setPage("team"); return { ok: true }; }
    if (res.status === 404) return { error: "not-found" };
    if (res.status === 401) return { error: "bad-pin" };
    return { error: "offline" };
  };
  const logout = () => { saveAuth(null); setAuth(null); setS(START()); setSel(null); setBattle(null); setPage("team"); };

  /* team building (heroId-based) */
  const tapTray = (id) => setSel((p) => (p && p.id === id ? null : { id }));
  const tapCell = (cell) => {
    const occ = teamUnits.find((u) => u.col === cell.col && u.row === cell.row);
    if (sel) {
      const inTeam = s.team.find((t) => t.heroId === sel.id);
      if (occ && occ.heroId !== sel.id) {
        setS((p) => {
          let team = p.team.slice();
          const me = team.find((t) => t.heroId === sel.id);
          if (me) { const oc = me.col, or = me.row; team = team.map((t) => t.heroId === sel.id ? { ...t, col: cell.col, row: cell.row } : t.heroId === occ.heroId ? { ...t, col: oc, row: or } : t); }
          else { team = team.filter((t) => t.heroId !== occ.heroId).concat({ heroId: sel.id, col: cell.col, row: cell.row }); }
          return { ...p, team };
        });
        setSel(null); return;
      }
      if (!inTeam && teamUnits.length >= cap) { toast(`Court is full — reach Lv ${s.level + 1} to expand`); return; }
      setS((p) => { const team = p.team.find((t) => t.heroId === sel.id) ? p.team.map((t) => t.heroId === sel.id ? { ...t, col: cell.col, row: cell.row } : t) : [...p.team, { heroId: sel.id, col: cell.col, row: cell.row }]; return { ...p, team }; });
      setSel(null);
    } else if (occ) setSel({ id: occ.heroId });
  };
  const removeFromTeam = (id) => { setS((p) => ({ ...p, team: p.team.filter((t) => t.heroId !== id) })); setSel(null); };

  /* packs */
  const openPack = () => {
    if (s.coins < PACK_COST) return toast(`Need ${PACK_COST} ◈`);
    const ids = rollPack(mulberry32(randSeed()));
    const nc = JSON.parse(JSON.stringify(s.collection)); let bonus = 0; const rev = [];
    ids.forEach((id) => {
      const cur = nc[id];
      if (!cur) { nc[id] = { star: 1, copies: 0 }; rev.push({ id, status: "new" }); }
      else if (cur.star >= MAX_STAR && cur.copies >= UPGRADE_COPIES) { bonus += 20; rev.push({ id, status: "max" }); }
      else { const copies = Math.min(UPGRADE_COPIES, cur.copies + 1); nc[id] = { ...cur, copies }; rev.push({ id, status: copies >= UPGRADE_COPIES ? "ready" : "copy" }); }
    });
    setReveal(rev); setS((p) => ({ ...p, coins: p.coins - PACK_COST + bonus, collection: nc }));
  };

  /* upgrades */
  const upgrade = (id) => {
    const c = col[id]; if (!c) return;
    if (c.star >= MAX_STAR) return toast("Already at max ★");
    if (c.copies < UPGRADE_COPIES) return toast(`Need ${UPGRADE_COPIES} copies`);
    const cost = upgradeCost(c.star); if (s.coins < cost) return toast(`Need ${cost} ◈`);
    setS((p) => ({ ...p, coins: p.coins - cost, collection: { ...p.collection, [id]: { star: c.star + 1, copies: c.copies - UPGRADE_COPIES } } }));
    toast(`${HERO[id].name} ascended to ★${c.star + 1}`);
  };

  /* bump → battle */
  const searchTimer = useRef(null);
  const startSearch = () => {
    if (teamUnits.length === 0) return toast("Deploy a court first");
    if (bumpState !== "idle") return;
    setBumpState("searching");
    searchTimer.current = setTimeout(() => { setBumpState("found"); setTimeout(() => { setBumpState("idle"); startBattle(); }, 800); }, 1900);
  };
  const startBattle = () => { const seed = randSeed(); const rival = makeRival(teamForSim, mulberry32(seed), s.level); const r = simulateField(teamForSim, rival, seed); setBattle({ rival, result: r, frame: 0, seed }); setResult(null); setPage("battle"); };
  const bumpArmed = useRef(false); const lastBump = useRef(0);
  useEffect(() => { bumpArmed.current = page === "bump" && bumpState === "idle"; });
  useEffect(() => { const onM = (e) => { if (!bumpArmed.current) return; const a = e.accelerationIncludingGravity || e.acceleration; if (!a) return; const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0); const now = Date.now(); if (mag > 26 && now - lastBump.current > 1500) { lastBump.current = now; startSearch(); } }; window.addEventListener("devicemotion", onM); return () => window.removeEventListener("devicemotion", onM); });
  const armMotion = async () => { try { if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") await DeviceMotionEvent.requestPermission(); } catch (e) {} };

  useEffect(() => { if (page !== "battle" || !battle) return; if (battle.frame >= battle.result.frames.length - 1) return; const id = setTimeout(() => setBattle((b) => ({ ...b, frame: b.frame + 1 })), 130); return () => clearTimeout(id); }, [battle, page]);
  const done = page === "battle" && battle && battle.frame >= battle.result.frames.length - 1;
  const resolvedRef = useRef(false);
  useEffect(() => { if (battle) resolvedRef.current = false; }, [battle && battle.seed]);
  useEffect(() => {
    if (!done || resolvedRef.current) return; resolvedRef.current = true;
    const won = battle.result.winner === "A"; const reward = won ? WIN_COINS : PLAY_COINS; const gx = won ? WIN_XP : PLAY_XP;
    let xp = s.xp + gx, lvl = s.level, leveled = false;
    while (xp >= xpNeeded(lvl)) { xp -= xpNeeded(lvl); lvl++; leveled = true; }
    setS((p) => ({ ...p, coins: p.coins + reward, games: p.games + 1, wins: p.wins + (won ? 1 : 0), losses: p.losses + (won ? 0 : 1), xp, level: lvl }));
    setResult({ won, reward, gx, leveledTo: leveled ? lvl : null });
  }, [done]);

  if (!loaded) return (<div style={{ ...GRAIN, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>{FONTS}<span style={{ fontFamily: DISPLAY, animation: "flick 1.3s infinite" }}>Casting the lots…</span></div>);
  if (!s.account) return (<div style={{ ...GRAIN, minHeight: "100vh", maxWidth: 460, margin: "0 auto", borderLeft: `1px solid ${C.line}`, borderRight: `1px solid ${C.line}` }}>{FONTS}<Onboard onCreate={createAccount} onLogin={loginAccount} /></div>);

  const frame = battle ? battle.result.frames[battle.frame] : null;
  const inBattle = page === "battle";

  return (
    <div style={{ ...GRAIN, minHeight: "100vh", color: C.ink, fontFamily: BODY, maxWidth: 460, margin: "0 auto", borderLeft: `1px solid ${C.line}`, borderRight: `1px solid ${C.line}`, display: "flex", flexDirection: "column", paddingBottom: inBattle ? 0 : 64 }}>
      {FONTS}
      <div style={{ padding: "8px 14px 6px", borderBottom: `2px solid ${C.ink}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 22, letterSpacing: 2 }}>AUGUR</span>
        <span style={{ fontFamily: MONO, fontSize: 15, color: C.ochre }}>{s.coins} ◈</span>
      </div>
      {!inBattle && <ProfileStrip s={s} cap={cap} cloud={!!auth} onLogout={logout} />}

      <div style={{ flex: 1, padding: 12 }}>
        {page === "team" && <TeamPage {...{ s, col, teamUnits, trayIds, traits, built, cap, sel, tapTray, tapCell, removeFromTeam, goBump: () => setPage("bump") }} />}
        {page === "collection" && <CollectionPage col={col} onInspect={setInspectHero} />}
        {page === "packs" && <PacksPage coins={s.coins} openPack={openPack} />}
        {page === "bump" && <BumpPage state={bumpState} onSearch={startSearch} armMotion={armMotion} hasTeam={teamUnits.length > 0} s={s} cap={cap} />}
        {inBattle && battle && frame && <BattleView battle={battle} frame={frame} done={done} result={result} setBattle={setBattle} onContinue={() => { setBattle(null); setResult(null); setPage("bump"); }} />}
      </div>

      {!inBattle && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 460, margin: "0 auto", display: "flex", borderTop: `2px solid ${C.ink}`, background: C.paper2 }}>
          {[["team", "⚔", "Court"], ["collection", "❏", "Codex"], ["packs", "✦", "Packs"], ["bump", "⚡", "Bump"]].map(([id, gl, lab]) => (
            <button key={id} onClick={() => { setSel(null); setPage(id); }} style={{ flex: 1, background: page === id ? C.ink : "transparent", color: page === id ? C.paper : C.ink, border: "none", borderRight: `1px solid ${C.ink}`, padding: "8px 0", cursor: "pointer", fontFamily: DISPLAY }}>
              <div style={{ fontSize: 17, lineHeight: 1 }}>{gl}</div><div style={{ fontSize: 10, letterSpacing: 1, marginTop: 2 }}>{lab}</div>
            </button>
          ))}
        </div>
      )}

      {reveal && <PackReveal cards={reveal} onClose={() => setReveal(null)} />}
      {inspectHero && <HeroSheet id={inspectHero} col={col} coins={s.coins} onUpgrade={() => upgrade(inspectHero)} onClose={() => setInspectHero(null)} />}
      {note && <div style={{ position: "fixed", bottom: 76, left: "50%", transform: "translateX(-50%)", ...press(C.blood, 3), padding: "8px 16px", fontFamily: SERIF, fontSize: 14, zIndex: 80, textAlign: "center" }}>{note}</div>}
    </div>
  );
}

/* ---------- profile strip (key progression info) ---------- */
function ProfileStrip({ s, cap, cloud, onLogout }) {
  const need = xpNeeded(s.level); const pct = Math.min(100, (s.xp / need) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: `1px solid ${C.ink}`, background: C.paper2 }}>
      <span style={{ fontFamily: DISPLAY, fontSize: 13 }}>{s.account.name}</span>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 11 }}>Lv {s.level}</span>
        <div style={{ flex: 1, height: 6, background: C.paper, border: `1px solid ${C.ink}` }}><div style={{ height: "100%", background: C.lapis, width: pct + "%" }} /></div>
        <span style={{ fontFamily: MONO, fontSize: 8, color: C.ink2 }}>{s.xp}/{need}</span>
      </div>
      <span style={{ fontFamily: MONO, fontSize: 10, color: cloud ? C.mend : C.ink2 }} title={cloud ? "synced to cloud" : "local only"}>{cloud ? "\u2601" : "court"} {cap}</span>
      <button onClick={onLogout} title="sign out" style={{ ...press(C.ink, 1), background: C.paper, fontFamily: MONO, fontSize: 10, padding: "2px 6px", cursor: "pointer" }}>\u23cf</button>
    </div>
  );
}

/* ---------- onboarding + login ---------- */
function Onboard({ onCreate, onLogin }) {
  const [mode, setMode] = useState("create");      // create | login
  const [step, setStep] = useState("name");         // name | pick (create only)
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [picks, setPicks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const toggle = (id) => setPicks((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length < 2 ? [...p, id] : p);
  const pinOk = pin.length >= 4 && pin.length <= 12;

  const doCreate = async () => { setBusy(true); setErr(""); const r = await onCreate(name, pin, picks); setBusy(false); if (r && r.error === "taken") { setErr("That name is taken — switch to Returning to log in."); } };
  const doLogin = async () => { setBusy(true); setErr(""); const r = await onLogin(name, pin); setBusy(false); if (r && r.error === "not-found") setErr("No augur by that name."); else if (r && r.error === "bad-pin") setErr("Wrong PIN."); else if (r && r.error === "offline") setErr("Cloud unavailable right now."); };

  const field = (val, set, ph, pwd) => (
    <input value={val} onChange={(e) => set(pwd ? e.target.value.replace(/\D/g, "").slice(0, 12) : e.target.value)} maxLength={pwd ? 12 : 16}
      type={pwd ? "password" : "text"} inputMode={pwd ? "numeric" : "text"} placeholder={ph}
      style={{ fontFamily: BODY, fontSize: 16, padding: "8px 10px", border: `1.5px solid ${C.ink}`, background: C.paper, color: C.ink, outline: "none", width: "100%" }} />
  );
  const tabs = (
    <div style={{ display: "flex", gap: 0, border: `1.5px solid ${C.ink}`, alignSelf: "center" }}>
      {[["create", "New augur"], ["login", "Returning"]].map(([m, l]) => (
        <button key={m} onClick={() => { setMode(m); setErr(""); setStep("name"); }} style={{ fontFamily: MONO, fontSize: 11, padding: "6px 14px", cursor: "pointer", border: "none", borderRight: m === "create" ? `1.5px solid ${C.ink}` : "none", background: mode === m ? C.ink : C.paper, color: mode === m ? C.paper : C.ink }}>{l}</button>
      ))}
    </div>
  );

  return (
    <div style={{ padding: 22, minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", gap: 16 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 36, letterSpacing: 3 }}>AUGUR</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.ink2, letterSpacing: 1 }}>SET·I — THE·TWO·LANDS</div>
      </div>
      {tabs}
      {err && <div style={{ fontFamily: SERIF, fontSize: 12, color: C.blood, textAlign: "center" }}>{err}</div>}

      {mode === "login" ? (
        <div style={{ ...press(C.lapis, 4), padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 16 }}>Welcome back</div>
          {field(name, setName, "augur name")}
          {field(pin, setPin, "secret PIN", true)}
          <Btn color={C.lapis} onClick={doLogin} disabled={busy || !name.trim() || !pinOk}>{busy ? "…" : "Enter the Two Lands"}</Btn>
        </div>
      ) : step === "name" ? (
        <div style={{ ...press(C.lapis, 4), padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 16 }}>Name your augur</div>
          {field(name, setName, "enter a name…")}
          <div style={{ fontFamily: MONO, fontSize: 9, color: C.ink2 }}>set a PIN (4–12 digits) to recover your account anywhere</div>
          {field(pin, setPin, "secret PIN", true)}
          <Btn color={C.lapis} onClick={() => setStep("pick")} disabled={!name.trim() || !pinOk}>Begin the reading →</Btn>
        </div>
      ) : (
        <div style={{ ...press(C.ochre, 4), padding: 16 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 16, marginBottom: 4 }}>Choose your first two gods</div>
          <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 12, color: C.ink2, marginBottom: 12 }}>Three present themselves. Two will answer your call.</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            {STARTER_TRIO.map((id) => {
              const h = HERO[id]; const on = picks.includes(id); const c = CLASSES[h.cls];
              return (
                <div key={id} onClick={() => toggle(id)} style={{ flex: 1, ...press(on ? C.blood : C.ink, on ? 3 : 1), padding: 8, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: on ? C.paper2 : C.paper }}>
                  <Tile heroId={id} star={1} size={48} />
                  <span style={{ fontFamily: DISPLAY, fontSize: 12 }}>{h.name}</span>
                  <span style={{ fontFamily: MONO, fontSize: 8, color: c.ink }}>{c.glyph} {c.label}</span>
                  <span style={{ fontFamily: SERIF, fontSize: 9, fontStyle: "italic", color: C.ink2, textAlign: "center", lineHeight: 1.15 }}>{BLURB[id]}</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 14, textAlign: "center" }}>
            <Btn color={C.ochre} onClick={doCreate} disabled={busy || picks.length !== 2}>{busy ? "sealing…" : picks.length === 2 ? "Seal the pact" : `Pick ${2 - picks.length} more`}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- TEAM ---------- */
function TeamPage({ s, col, teamUnits, trayIds, traits, built, cap, sel, tapTray, tapCell, removeFromTeam, goBump }) {
  const selId = sel ? sel.id : null;
  const selInTeam = selId ? s.team.find((t) => t.heroId === selId) : null;
  const totalLife = built.reduce((a, u) => a + u.maxHp, 0);
  const totalPower = built.reduce((a, u) => a + u.ad, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 16 }}>Your Court</span>
        <Btn small onClick={goBump}>To battle ⚡</Btn>
      </div>
      <Field onCellTap={tapCell} highlightHalf={!!sel}>
        <div style={{ position: "absolute", top: 8, left: 0, right: 0, textAlign: "center", fontFamily: SERIF, fontStyle: "italic", fontSize: 12, color: C.ink2 }}>— rivals appear here —</div>
        {teamUnits.map((u) => <Token key={u.heroId} meta={{ heroId: u.heroId, side: "A", star: u.star, maxHp: 1 }} pos={{ col: u.col, row: u.row }} hp={1} sh={0} dead={false} ghost selected={selId === u.heroId} onClick={() => tapTray(u.heroId)} />)}
      </Field>
      <div style={{ fontFamily: MONO, fontSize: 9, color: C.ink2, textAlign: "center" }}>{sel ? "tap a hex to deploy / swap" : "tap a god, then a hex"} · {teamUnits.length}/{cap} deployed</div>

      <div style={{ display: "flex", border: `1.5px solid ${C.ink}`, background: C.paper2 }}>
        {[["Court", `${teamUnits.length}/${cap}`], ["Total Life", totalLife || "—"], ["Total Power", totalPower || "—"]].map(([l, v], i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", padding: "6px 2px", borderRight: i < 2 ? `1px solid ${C.ink}` : "none" }}>
            <div style={{ fontFamily: MONO, fontSize: 8, color: C.ink2, textTransform: "uppercase" }}>{l}</div>
            <div style={{ fontFamily: MONO, fontSize: 16 }}>{v}</div>
          </div>
        ))}
      </div>

      {selId && <Inspector id={selId} star={col[selId].star} inTeam={!!selInTeam} onRemove={() => removeFromTeam(selId)} />}

      {traits.length > 0 && (
        <div>
          <SectionRule>Synergies</SectionRule>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {traits.map((t) => (
              <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 8, opacity: t.active ? 1 : 0.5 }}>
                <span style={{ width: 16, textAlign: "center", color: t.ink, fontSize: 13 }}>{t.glyph}</span>
                <span style={{ fontFamily: SERIF, fontSize: 13, width: 74, color: t.active ? t.ink : C.ink2 }}>{t.label}</span>
                <span style={{ display: "flex", gap: 2 }}>{t.breaks.map((b, i) => <span key={i} style={{ fontFamily: MONO, fontSize: 10, padding: "0 4px", border: `1px solid ${t.ink}`, background: t.count >= b ? t.ink : "transparent", color: t.count >= b ? C.paper : t.ink }}>{b}</span>)}</span>
                <span style={{ fontFamily: SERIF, fontSize: 11.5, flex: 1, fontStyle: t.active ? "normal" : "italic" }}>{t.tier >= 0 ? TRAIT_TEXT[t.key][t.tier] : `${t.count}/${t.breaks[0]}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionRule>Reserve · {trayIds.length}</SectionRule>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minHeight: 50 }}>
          {trayIds.length === 0 && <span style={{ fontFamily: SERIF, fontStyle: "italic", color: C.ink2, fontSize: 13 }}>All your gods are deployed. Open packs to recruit more.</span>}
          {trayIds.map((id) => <Tile key={id} heroId={id} star={col[id].star} size={46} selected={selId === id} onClick={() => tapTray(id)} />)}
        </div>
      </div>
    </div>
  );
}

function Inspector({ id, star, inTeam, onRemove }) {
  const h = HERO[id]; const o = ORIGINS[h.origin], c = CLASSES[h.cls]; const sm = starMul(star);
  const stat = (l, v) => (<div style={{ flex: 1, textAlign: "center" }}><div style={{ fontFamily: MONO, fontSize: 8, color: C.ink2, textTransform: "uppercase" }}>{l}</div><div style={{ fontFamily: MONO, fontSize: 14 }}>{v}</div></div>);
  return (
    <div style={{ ...press(o.ink, 3), padding: 10, animation: "rise .2s" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 18 }}>{h.name}{star > 1 && <span style={{ color: C.ochre, fontSize: 12 }}> {"★".repeat(star)}</span>}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: COST_INK[h.cost] }}>{"◈".repeat(h.cost)}</span>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 2, fontFamily: SERIF, fontSize: 12 }}>
        <span style={{ color: o.ink }}>{o.glyph} {o.label}</span><span style={{ color: c.ink }}>{c.glyph} {c.label}</span><span style={{ color: C.ink2 }}>{c.range > 1 ? `range ${c.range}` : "melee"}</span>
      </div>
      <div style={{ display: "flex", gap: 4, margin: "8px 0", padding: "6px 0", borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
        {stat("Life", Math.round(h.hp * sm))}{stat("Power", Math.round(h.ad * sm))}{stat("Magic", h.magic ? Math.round(h.magic * sm) : "—")}{stat("Armor", h.armor)}
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 13 }}><span style={{ fontStyle: "italic", color: c.ink }}>{h.ability}</span><span style={{ color: C.ink2 }}> — {BLURB[id]}</span></div>
      <div style={{ marginTop: 8 }}>{inTeam ? <Btn small color={C.blood} onClick={onRemove}>↩ Remove from court</Btn> : <span style={{ fontFamily: MONO, fontSize: 10, color: C.ink2 }}>tap a hex to deploy</span>}</div>
    </div>
  );
}

/* ---------- CODEX (collection) ---------- */
function CollectionPage({ col, onInspect }) {
  const ownedCount = Object.keys(col).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 16 }}>The Codex</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.ink2 }}>{ownedCount}/{HEROES.length} discovered</span>
      </div>
      {[1, 2, 3, 4, 5].map((cost) => (
        <div key={cost}>
          <SectionRule action={<span style={{ fontFamily: MONO, fontSize: 10, color: COST_INK[cost] }}>{"◈".repeat(cost)}</span>}>Cost {cost}</SectionRule>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {HEROES.filter((h) => h.cost === cost).map((h) => {
              const own = col[h.id]; const ready = own && own.copies >= UPGRADE_COPIES && own.star < MAX_STAR;
              return (
                <div key={h.id} onClick={() => onInspect(h.id)} style={{ cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <div style={{ position: "relative" }}>
                    <Tile heroId={h.id} star={own ? own.star : 1} size={52} dim={!own} />
                    {!own && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: C.ink2 }}>🔒</div>}
                    {ready && <div style={{ position: "absolute", top: -5, right: -5, ...press(C.ochre, 1), fontFamily: MONO, fontSize: 9, padding: "0 3px", color: C.ink }}>↑</div>}
                  </div>
                  <span style={{ fontFamily: SERIF, fontSize: 10, color: own ? C.ink : C.ink2 }}>{own ? h.name : "—"}</span>
                  {own ? (
                    own.star >= MAX_STAR
                      ? <span style={{ fontFamily: MONO, fontSize: 8, color: C.ochre }}>MAX ★</span>
                      : <span style={{ fontFamily: MONO, fontSize: 9, color: ready ? C.ochre : C.ink2 }}>{own.copies}/{UPGRADE_COPIES}</span>
                  ) : <span style={{ fontFamily: MONO, fontSize: 8, color: C.line }}>—</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function HeroSheet({ id, col, coins, onUpgrade, onClose }) {
  const h = HERO[id]; const o = ORIGINS[h.origin], c = CLASSES[h.cls]; const own = col[id];
  const star = own ? own.star : 0; const sm = starMul(star || 1);
  const ready = own && own.copies >= UPGRADE_COPIES && own.star < MAX_STAR;
  const cost = own ? upgradeCost(own.star) : 0;
  const stat = (l, v, nv) => (<div style={{ flex: 1, textAlign: "center" }}><div style={{ fontFamily: MONO, fontSize: 8, color: C.ink2, textTransform: "uppercase" }}>{l}</div><div style={{ fontFamily: MONO, fontSize: 15 }}>{v}{nv != null && ready && <span style={{ color: C.mend, fontSize: 10 }}> →{nv}</span>}</div></div>);
  const nm = starMul((star || 1) + 1);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#211c1288", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90, padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...press(o.ink, 4), padding: 16, maxWidth: 320, width: "100%", animation: "rise .2s" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Tile heroId={id} star={star || 1} size={54} dim={!own} />
          <div>
            <div style={{ fontFamily: DISPLAY, fontSize: 20 }}>{h.name}</div>
            <div style={{ fontFamily: SERIF, fontSize: 12 }}><span style={{ color: o.ink }}>{o.glyph} {o.label}</span> · <span style={{ color: c.ink }}>{c.glyph} {c.label}</span></div>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.ink2 }}>{own ? (own.star >= MAX_STAR ? `★${star} · MAX` : `★${star} · ${own.copies}/${UPGRADE_COPIES} copies`) : "not yet discovered"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, margin: "12px 0", padding: "8px 0", borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
          {stat("Life", Math.round(h.hp * sm), Math.round(h.hp * nm))}{stat("Power", Math.round(h.ad * sm), Math.round(h.ad * nm))}{stat("Magic", h.magic ? Math.round(h.magic * sm) : "—", h.magic ? Math.round(h.magic * nm) : null)}{stat("Armor", h.armor)}{stat("Range", c.range > 1 ? c.range : "1")}
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 14 }}><span style={{ fontStyle: "italic", color: c.ink }}>{h.ability}</span> — {BLURB[id]}</div>
        <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {own && own.star < MAX_STAR
            ? <Btn small color={C.ochre} onClick={onUpgrade} disabled={!ready || coins < cost}>{ready ? `Ascend to ★${star + 1} · ${cost} ◈` : `Need ${UPGRADE_COPIES} copies`}</Btn>
            : <span style={{ fontFamily: MONO, fontSize: 10, color: C.ink2 }}>{own ? "fully ascended" : "find this god in packs"}</span>}
          <Btn small onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
}

/* ---------- PACKS ---------- */
function PacksPage({ coins, openPack }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "center", paddingTop: 8 }}>
      <span style={{ fontFamily: DISPLAY, fontSize: 18, alignSelf: "flex-start" }}>The Reliquary</span>
      <div style={{ ...press(C.ochre, 5), width: 180, height: 226, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, position: "relative" }}>
        <div style={{ position: "absolute", inset: 8, border: `1px solid ${C.line}` }} />
        <div style={{ fontSize: 44, color: C.ochre }}>𓂀</div>
        <div style={{ fontFamily: DISPLAY, fontSize: 17, letterSpacing: 1 }}>Sealed Pack</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.ink2 }}>{PACK_SIZE} gods within</div>
      </div>
      <Btn color={C.ochre} onClick={openPack} disabled={coins < PACK_COST}>Break the seal · {PACK_COST} ◈</Btn>
      <div style={{ ...press(C.ink, 2), padding: 10, width: "100%", maxWidth: 280 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 13, marginBottom: 6 }}>Pull odds</div>
        {[1, 2, 3, 4, 5].map((c) => (<div key={c} style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 11, color: COST_INK[c] }}><span>{"◈".repeat(c)} cost {c}</span><span>{PACK_ODDS[c - 1]}%</span></div>))}
        <div style={{ fontFamily: SERIF, fontSize: 11, fontStyle: "italic", color: C.ink2, marginTop: 6 }}>Collect {UPGRADE_COPIES} copies of a god, then spend coins in the Codex to ascend its ★.</div>
      </div>
    </div>
  );
}

function PackReveal({ cards, onClose }) {
  const tag = { new: ["NEW", C.ochre], ready: ["★ READY", C.ochre], copy: ["+1 copy", C.line], max: ["+20 ◈", C.mend] };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#211c12dd", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 95, gap: 16 }}>
      <div style={{ fontFamily: DISPLAY, fontSize: 22, color: C.paper, letterSpacing: 2 }}>The seal breaks</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", maxWidth: 340 }}>
        {cards.map((c, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, animation: "rise .4s backwards", animationDelay: i * 0.12 + "s" }}>
            <Tile heroId={c.id} star={1} size={56} showCost />
            <span style={{ fontFamily: SERIF, fontSize: 11, color: C.paper }}>{HERO[c.id].name}</span>
            <span style={{ fontFamily: MONO, fontSize: 8, color: tag[c.status][1] }}>{tag[c.status][0]}</span>
          </div>
        ))}
      </div>
      <span style={{ fontFamily: MONO, fontSize: 11, color: C.line }}>tap to continue</span>
    </div>
  );
}

/* ---------- BUMP ---------- */
function BumpPage({ state, onSearch, armMotion, hasTeam, s, cap }) {
  useEffect(() => { armMotion(); }, []);
  const searching = state === "searching", found = state === "found";
  const label = found ? "Rival found" : searching ? "Seeking a nearby augur…" : hasTeam ? "Tap the eye — or bump phones" : "Deploy a court first";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, paddingTop: 14 }}>
      <style>{`@keyframes sonar{0%{transform:translate(-50%,-50%) scale(.4);opacity:.8}100%{transform:translate(-50%,-50%) scale(1.8);opacity:0}}`}</style>
      <span style={{ fontFamily: DISPLAY, fontSize: 18, alignSelf: "flex-start" }}>The Crossing</span>
      <div onClick={onSearch} style={{ position: "relative", width: 220, height: 210, display: "flex", alignItems: "center", justifyContent: "center", cursor: hasTeam ? "pointer" : "default", marginTop: 6 }}>
        {(searching || found) && [0, 1, 2].map((i) => <div key={i} style={{ position: "absolute", top: "50%", left: "50%", width: 200, height: 200, borderRadius: "50%", border: `2px solid ${found ? C.mend : C.lapis}`, animation: `sonar 1.6s ease-out ${i * 0.5}s infinite` }} />)}
        <div style={{ width: 148, height: 148, borderRadius: "50%", border: `2.5px solid ${C.ink}`, background: C.paper2, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `4px 4px 0 ${found ? C.mend : searching ? C.lapis : C.ink}`, transition: "box-shadow .3s" }}>
          <span style={{ fontSize: 62, color: found ? C.mend : searching ? C.lapis : C.ink, animation: searching ? "flick 1s infinite" : "none" }}>𓂀</span>
        </div>
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 15, fontStyle: "italic", color: found ? C.mend : C.ink2, minHeight: 22 }}>{label}</div>
      {!searching && !found && hasTeam && <Btn color={C.lapis} onClick={onSearch}>⚡ Find a rival</Btn>}
      <div style={{ display: "flex", border: `1.5px solid ${C.ink}`, background: C.paper2, marginTop: 4 }}>
        {[["Level", s.level], ["Court", cap], ["Won", s.wins], ["Lost", s.losses]].map(([l, v], i) => (
          <div key={i} style={{ padding: "6px 16px", textAlign: "center", borderRight: i < 3 ? `1px solid ${C.ink}` : "none" }}>
            <div style={{ fontFamily: MONO, fontSize: 8, color: C.ink2, textTransform: "uppercase" }}>{l}</div><div style={{ fontFamily: MONO, fontSize: 16 }}>{v}</div>
          </div>
        ))}
      </div>
      <p style={{ fontFamily: SERIF, fontSize: 10.5, color: C.ink2, fontStyle: "italic", lineHeight: 1.5, textAlign: "center", maxWidth: 300 }}>Win to earn coins and experience — level up to deploy a larger court. The Cloudflare matcher drops into this exact spot for real phone-to-phone duels.</p>
    </div>
  );
}

/* ---------- BATTLE ---------- */
function SpriteFX({ sp }) {
  const def = FX_SPRITES[sp.key]; if (!def) return null;
  const SZ = 58;
  return <div style={{ position: "absolute", left: sp.x, top: sp.y, width: SZ, height: SZ, marginLeft: -SZ / 2, marginTop: -SZ / 2, zIndex: 9, pointerEvents: "none",
    backgroundImage: `url(${def.uri})`, backgroundSize: "100% 100%", imageRendering: "pixelated",
    animation: `${def.spin ? "sfxpopspin .5s" : "sfxpop .45s"} ease-out forwards` }} />;
}

function BattleView({ battle, frame, done, result, setBattle, onContinue }) {
  const meta = battle.result.meta; const won = battle.result.winner === "A";
  const [sprites, setSprites] = useState([]);
  const sid = useRef(0);
  useEffect(() => {
    const news = frame.fx.filter((e) => e.k === "sfx").map((e) => ({ id: sid.current++, key: e.key, x: cx(e.tc.col, e.tc.row), y: cy(e.tc.row) }));
    if (!news.length) return;
    setSprites((p) => [...p, ...news]);
    const ids = new Set(news.map((n) => n.id));
    const t = setTimeout(() => setSprites((p) => p.filter((s) => !ids.has(s.id))), 520);
    return () => clearTimeout(t);
  }, [battle.frame]);
  const flashFor = (uid) => { const e = frame.fx.find((x) => x.t === uid && x.k === "hit"); return e ? (e.magic ? C.lapis : C.blood) : null; };
  const aliveA = meta.filter((m) => m.side === "A" && !frame.dead[m.uid]).length;
  const aliveB = meta.filter((m) => m.side === "B" && !frame.dead[m.uid]).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 11 }}>
        <span style={{ color: C.blood }}>Rival Court · {aliveB}</span><span style={{ color: C.mend }}>{aliveA} · Your Court</span>
      </div>
      <Field>
        {meta.map((m) => <Token key={m.uid} meta={m} pos={frame.pos[m.uid]} hp={frame.hp[m.uid]} sh={frame.sh[m.uid]} mp={frame.mp ? frame.mp[m.uid] : 0} dead={frame.dead[m.uid]} flash={flashFor(m.uid)} />)}
        <Effects frame={frame} />
        {sprites.map((sp) => <SpriteFX key={sp.id} sp={sp} />)}
      </Field>
      {!done ? (
        <div>
          <div style={{ height: 4, background: C.paper2, border: `1px solid ${C.ink}` }}><div style={{ height: "100%", background: C.ink, width: (battle.frame / battle.result.frames.length) * 100 + "%", transition: "width .13s linear" }} /></div>
          <button onClick={() => setBattle((b) => ({ ...b, frame: b.result.frames.length - 1 }))} style={{ ...press(C.ink, 2), width: "100%", marginTop: 8, fontFamily: MONO, fontSize: 12, padding: 8, cursor: "pointer" }}>skip ⏭</button>
        </div>
      ) : (
        <div style={{ textAlign: "center", animation: "rise .35s", marginTop: 6 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 32, letterSpacing: 2, color: won ? C.mend : C.blood }}>{won ? "PREVAILED" : "FALLEN"}</div>
          {result && <div style={{ fontFamily: SERIF, fontSize: 14, color: C.ink2, margin: "4px 0 6px" }}>+{result.reward} ◈ · +{result.gx} xp</div>}
          {result && result.leveledTo && <div style={{ fontFamily: DISPLAY, fontSize: 16, color: C.ochre, marginBottom: 8 }}>Level {result.leveledTo}! Court grows to {teamCap(result.leveledTo)}</div>}
          <div style={{ marginTop: 6 }}><Btn color={C.ink} onClick={onContinue}>Return to the Crossing</Btn></div>
        </div>
      )}
    </div>
  );
}
