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
    if (T === "nuke") { const g = lowest(u); if (g) damage(u, g, 230 + u.magic * 1.9, true); }
    else if (T === "aoe") foes(u).forEach((e) => damage(u, e, 95 + u.magic * 0.95, true));
    else if (T === "aoe_phys") foes(u).forEach((e) => damage(u, e, 60 + u.ad * 0.85, false));
    else if (T === "multi") foes(u).slice().sort((a, b) => a.hp - b.hp).slice(0, 3).forEach((e) => damage(u, e, 130 + u.magic * 1.15, true));
    else if (T === "execute") { const g = lowest(u); if (g) { if (g.hp / g.maxHp < 0.30) damage(u, g, g.hp + 9e4, false); else damage(u, g, 200 + u.ad * 1.3, false); u.hp = Math.min(u.maxHp, u.hp + 110); fx.push({ k: "heal", tc: { col: u.col, row: u.row } }); } }
    else if (T === "heal_team") { const amt = Math.round(140 + u.magic * 1.3); friends(u).forEach((a) => { a.hp = Math.min(a.maxHp, a.hp + amt); fx.push({ k: "heal", tc: { col: a.col, row: a.row } }); }); }
    else if (T === "shield_self") { u.shield += 340; fx.push({ k: "buff", tc: { col: u.col, row: u.row } }); }
    else if (T === "shield_team") friends(u).forEach((a) => { a.shield += 150; fx.push({ k: "buff", tc: { col: a.col, row: a.row } }); });
    else if (T === "evade") { u.dodge = Math.min(0.75, u.dodge + 0.35); u.as += 0.45; fx.push({ k: "buff", tc: { col: u.col, row: u.row } }); }
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
    const pos = {}, hp = {}, sh = {}, dead = {};
    units.forEach((u) => { pos[u.uid] = { col: u.col, row: u.row }; hp[u.uid] = Math.max(0, Math.round(u.hp)); sh[u.uid] = Math.round(u.shield); dead[u.uid] = u.hp <= 0; });
    frames.push({ pos, hp, sh, dead, fx });
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
          u.mana = Math.min(u.maxMana, u.mana + 10);
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

function Token({ meta, pos, hp, sh, dead, selected, flash, ghost, onClick }) {
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
        <div style={{ position: "absolute", bottom: -5, left: TOK * 0.1, width: TOK * 0.8, height: 4, background: C.paper2, border: `1px solid ${C.ink}`, display: "flex" }}>
          <div style={{ width: pctHp + "%", background: meta.side === "A" ? C.mend : C.blood }} />
          <div style={{ width: pctSh + "%", background: C.ochre }} />
        </div>
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
  const toast = (m) => { setNote(m); setTimeout(() => setNote(null), 1600); };

  useEffect(() => { (async () => { try { const r = await window.storage.get(SAVE); if (r && r.value) setS({ ...START(), ...JSON.parse(r.value) }); } catch (e) {} setLoaded(true); })(); }, []);
  useEffect(() => { if (loaded) (async () => { try { await window.storage.set(SAVE, JSON.stringify(s)); } catch (e) {} })(); }, [s, loaded]);

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

  /* onboarding */
  const createAccount = (name, picks) => {
    const collection = {}; picks.forEach((id) => (collection[id] = { star: 1, copies: 0 }));
    setS({ ...START(), account: { name: name.trim() || "Augur" }, collection });
    setPage("team");
  };

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
  if (!s.account) return (<div style={{ ...GRAIN, minHeight: "100vh", maxWidth: 460, margin: "0 auto", borderLeft: `1px solid ${C.line}`, borderRight: `1px solid ${C.line}` }}>{FONTS}<Onboard onCreate={createAccount} /></div>);

  const frame = battle ? battle.result.frames[battle.frame] : null;
  const inBattle = page === "battle";

  return (
    <div style={{ ...GRAIN, minHeight: "100vh", color: C.ink, fontFamily: BODY, maxWidth: 460, margin: "0 auto", borderLeft: `1px solid ${C.line}`, borderRight: `1px solid ${C.line}`, display: "flex", flexDirection: "column", paddingBottom: inBattle ? 0 : 64 }}>
      {FONTS}
      <div style={{ padding: "8px 14px 6px", borderBottom: `2px solid ${C.ink}`, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 22, letterSpacing: 2 }}>AUGUR</span>
        <span style={{ fontFamily: MONO, fontSize: 15, color: C.ochre }}>{s.coins} ◈</span>
      </div>
      {!inBattle && <ProfileStrip s={s} cap={cap} />}

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
function ProfileStrip({ s, cap }) {
  const need = xpNeeded(s.level); const pct = Math.min(100, (s.xp / need) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: `1px solid ${C.ink}`, background: C.paper2 }}>
      <span style={{ fontFamily: DISPLAY, fontSize: 13 }}>{s.account.name}</span>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 11 }}>Lv {s.level}</span>
        <div style={{ flex: 1, height: 6, background: C.paper, border: `1px solid ${C.ink}` }}><div style={{ height: "100%", background: C.lapis, width: pct + "%" }} /></div>
        <span style={{ fontFamily: MONO, fontSize: 8, color: C.ink2 }}>{s.xp}/{need}</span>
      </div>
      <span style={{ fontFamily: MONO, fontSize: 10, color: C.ink2 }}>court {cap}</span>
    </div>
  );
}

/* ---------- onboarding ---------- */
function Onboard({ onCreate }) {
  const [step, setStep] = useState("name");
  const [name, setName] = useState("");
  const [picks, setPicks] = useState([]);
  const toggle = (id) => setPicks((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length < 2 ? [...p, id] : p);
  return (
    <div style={{ padding: 22, minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", gap: 18 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 36, letterSpacing: 3 }}>AUGUR</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: C.ink2, letterSpacing: 1 }}>SET·I — THE·TWO·LANDS</div>
      </div>
      {step === "name" ? (
        <div style={{ ...press(C.lapis, 4), padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 16 }}>Name your augur</div>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} placeholder="enter a name…" style={{ fontFamily: BODY, fontSize: 16, padding: "8px 10px", border: `1.5px solid ${C.ink}`, background: C.paper, color: C.ink, outline: "none" }} />
          <Btn color={C.lapis} onClick={() => setStep("pick")} disabled={!name.trim()}>Begin the reading →</Btn>
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
            <Btn color={C.ochre} onClick={() => onCreate(name, picks)} disabled={picks.length !== 2}>{picks.length === 2 ? "Seal the pact" : `Pick ${2 - picks.length} more`}</Btn>
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
function BattleView({ battle, frame, done, result, setBattle, onContinue }) {
  const meta = battle.result.meta; const won = battle.result.winner === "A";
  const flashFor = (uid) => { const e = frame.fx.find((x) => x.t === uid && x.k === "hit"); return e ? (e.magic ? C.lapis : C.blood) : null; };
  const aliveA = meta.filter((m) => m.side === "A" && !frame.dead[m.uid]).length;
  const aliveB = meta.filter((m) => m.side === "B" && !frame.dead[m.uid]).length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 11 }}>
        <span style={{ color: C.blood }}>Rival Court · {aliveB}</span><span style={{ color: C.mend }}>{aliveA} · Your Court</span>
      </div>
      <Field>
        {meta.map((m) => <Token key={m.uid} meta={m} pos={frame.pos[m.uid]} hp={frame.hp[m.uid]} sh={frame.sh[m.uid]} dead={frame.dead[m.uid]} flash={flashFor(m.uid)} />)}
        <Effects frame={frame} />
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
