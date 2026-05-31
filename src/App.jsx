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
const HERO_FX = { thoth: "nuke", apep: "venom", ra: "solar", sekhmet: "claw", set: "storm",
  ammit: "execute", khonsu: "execute", anubis: "execute",
  nephthys: "heal", isis: "heal",
  bes: "shield", sobek: "shield", osiris: "shield", hapi: "shield", nut: "shield",
  horus: "evade" };

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
      mana: Math.min(h.maxMana, h.mana + m.startMana + Math.round(h.maxMana * 0.28)), maxMana: h.maxMana,
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
    const fxk = HERO_FX[u.heroId] || "nuke";
    const sfx = (c) => fx.push({ k: "sfx", key: fxk, tc: { col: c.col, row: c.row } });
    if (T === "nuke") { const g = lowest(u); if (g) { sfx(g); damage(u, g, 230 + u.magic * 1.9, true); } }
    else if (T === "aoe") foes(u).forEach((e) => { sfx(e); damage(u, e, 95 + u.magic * 0.95, true); });
    else if (T === "aoe_phys") foes(u).forEach((e) => { sfx(e); damage(u, e, 60 + u.ad * 0.85, false); });
    else if (T === "multi") foes(u).slice().sort((a, b) => a.hp - b.hp).slice(0, 3).forEach((e) => { sfx(e); damage(u, e, 130 + u.magic * 1.15, true); });
    else if (T === "execute") { const g = lowest(u); if (g) { sfx(g); if (g.hp / g.maxHp < 0.30) damage(u, g, g.hp + 9e4, false); else damage(u, g, 200 + u.ad * 1.3, false); u.hp = Math.min(u.maxHp, u.hp + 110); } }
    else if (T === "heal_team") { const amt = Math.round(140 + u.magic * 1.3); friends(u).forEach((a) => { a.hp = Math.min(a.maxHp, a.hp + amt); sfx(a); }); }
    else if (T === "shield_self") { u.shield += 340; sfx(u); }
    else if (T === "shield_team") friends(u).forEach((a) => { a.shield += 150; sfx(a); });
    else if (T === "evade") { u.dodge = Math.min(0.75, u.dodge + 0.35); u.as += 0.45; sfx(u); }
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
          u.mana = Math.min(u.maxMana, u.mana + 20);
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
    @keyframes sfxframes { from { background-position-x: 0%; } to { background-position-x: 100%; } }
    @keyframes sfxenv { 0%{opacity:0} 12%{opacity:1} 84%{opacity:1} 100%{opacity:0} }
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
const FX_SPRITES = {"nuke": {"uri": "data:image/png;base64,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", "frames": 8, "spin": false}, "venom": {"uri": "data:image/png;base64,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", "frames": 12, "spin": true}, "solar": {"uri": "data:image/png;base64,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", "frames": 16, "spin": false}, "claw": {"uri": "data:image/png;base64,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", "frames": 10, "spin": true}, "storm": {"uri": "data:image/png;base64,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", "frames": 9, "spin": true}, "execute": {"uri": "data:image/png;base64,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", "frames": 7, "spin": false}, "heal": {"uri": "data:image/png;base64,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", "frames": 13, "spin": false}, "shield": {"uri": "data:image/png;base64,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", "frames": 13, "spin": false}, "evade": {"uri": "data:image/png;base64,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", "frames": 9, "spin": true}};
const FX_KEY = {"nuke": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAEnklEQVR42u2aXUxbZRjH/+85pS0FCt1I+BAMc85GMEGcojgTXeIyXaYXKnHGC5fFC7wwAU1M8MZwBUEvRlwWXSYzMcELG7lZICbGbTpgY3YbccAUYYMihYWPdqX0tOW8fy8oi3MwJ0k/WM/vpufiJM95Pt7n6y1gYGBgYGCQFKwfXmSyv8GULMFq8xCXIzLpTlCSJXjP0/ko2pGTxvF/ZIRGEjAwMDAwMDBIO/JeOc28fafSsxHKeauHtrr+lFE+4cNQuCwbusOcMg5J+DAkrSqKS2zpawBF07HHaUdNlzd9h6GGQT8HKNkRiLK0YzyphhDJEuyW5FZB/EmBj7u8uOieh2khDJlpgrSqMHuXYJ4Iwte1W9xXR2CV97q86F3U8cu1IK7eCAMAosU2bNu5BdsrcsEMJe7KJzUCACDz/V8pohJLX1QLAMg+2MdQeR4AQP/oUZGW+cH++s/MebsnvbdFadslGhgYpN9kmJaKmxsHUqbUJb4TPDLCmhcKsLzFkhLlMeH7ALttRWTo8yfvqdNTm4cIVSBzyAff1zVi00dAcCaEUPTeboUtx0ZZXekATQoW46B80ij85jotx0b5X0fF6fJQbR2+PxOlvf0arfXuNZUr7RhnohYmcT8ClmOjrLvsY/n3k7cpFL00B5MvsqZhDlQ5MDit3R9ebvOG6JZk97Jk9cmpu3rV6fKwYdDP2t7ZhIV93CLgpZ9u8PibpcgyK2g5N4eXTYrwa/pKVl+DT0YX2bK/GHarih+uBja350s7xumW5Fhs7/fvJchaHWD3suQAJY/PhZnIf4/EpQ8osmdgqyAyADyUdbuIteq/td7NfEUgF8RjDjOe35GDMwkyQNxq6xglLQCCAB4Rirhbo+NqcKLasvLKPADX2BLaz88hqhPPlGVheEbD72+Uik2VA4KxXxk7Euu9R4uKArOCKIBxCrQPBfBl7yw88xE8/oAN9bvyceK1ks13j+CW5AQlOzWdqxVhvQSIIyPr3g/U9s7SLcmOQJTmxoHNYYSWiSVekGSbN0Sny0MAaPUssWHQvyEFOjWdnZqemgbI23eKpqYrrO2dZUcgyguS/IOSpyVvtbtOl4fnJFcy/AZo84Y2bLy45wBf125hWgijvMCKimwVBYIwAZgKLkP3hgAASxEJCaDMYYbT5WH2wb7/pcz1+Qi+Oj+fumVQO7xTNB0Guk9O8YkSGzIzBIZnwlA0HQDw17SGCzMaKguseLUiF59Oa8gJ9zDw7a47Mvsh9wIDYR3fPZsvAKCmy8tJfxQ3D20TKWuAVfr3F4v+2LOtrp9qhoLsg31c/MApjj7o4YEqB5YlYbeZsF4IvFuVh3xBPOcNcWBKQ2WxFWevBTdfHwDErrqcudAbywX+UQ5nfvMh0ly5puwfJfmwIKYpsCCJhZCOS5MhjMyGkaEKlBdY0bQ9W6RkBNxh3aiE02nH3kE/J/3RW2F9N15UhKjtnWVAk5jwRRCIHaOKwky889QWFJkV3Bz08+iJMYQ/q0r9JYnaOsw2b4inYxNh3WUfTU1XUqacJcSCavMQqysdMKsCZ/YWpuetr4GBgYGBQerxN/8wPa8pw11HAAAAAElFTkSuQmCC", "venom": "data:image/png;base64,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", "solar": "data:image/png;base64,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", "claw": "data:image/png;base64,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", "storm": "data:image/png;base64,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", "execute": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAFK0lEQVR42u2aX0xbdRTHvxf6h/YWygpe/rRgB7IxpCb8mRY3jHNR4xZjEzIXiVFnYk00JiQ88bIHX3xy7IUX9zQ1JMtiwh4kLpNo3CYgf+oGAhuulq6saYFCaS/YrvT4xIJL6L0XWtqS+3n+3fs7v/M759zvOS0gIyMjIyMjIyMjIyOTRg7hEqVj35xMcQCLwrTsq8iEw7digB4jImk9AIQRgANnmKx2gE0zSI0mA27MegTX2jkHnagpQTgSAwB8Ozqb/RFwzloFfyiCmziZ8CZ7Glz0/nETNDUh/H1LjZ+mvZASNRlZAzorJsmo18K5GBa8+VN1ZchvCmDZUYDbzkVcn/ZiCKeYrI4AU6EW4UgMX7nqEh7kHYsJAPDbFSV6x+7iG38DkywbkuIAO+cgrVKBi/MWSYbNBXjMBfiEay5YHpAqNwff/eHC+dnDTLIvYdcpYEU/PV2dxTI270/otJ4GF7WYi3F/IZSSw6eEOlwW7YRmXNt27UeGMeq2OKmzYpKwX9nOWa0YIDvn2F8H35oqYoVOpspnybTrR+iC5QG1scOUzBTKOCls5xx0pEQPnVqBGd8qvn5YzwAAp8vD64dLcZgrQMXMBCUqfFP4cE+LXdKEUDP6CACqilm821KO87ZaXGp2EwBcnLcwP9/z4WARC/uxamRSfqfE2x3GCTr9fDl0agXGPcv43GFmNj9rjaYDuDLuFtQM7foRWovGMLfuAY8V3Mcn2fEZfFrqdlZM0tYCaNMMCt6+Ff3Urh8hMWvTEgF1uEwVimo0mgyoKtYBAJyLYUFJm+pP6kFVDZS5DPrWW5g9SYEu8xRVFetQX6ZHYC2KWDyOO54V6PIUcAfWJEvjZNBtcdJcgMfQ/EOsYkGwqCbNQDvnIJNei6ZKA5orDcjTEb6/5cGNGS886z6sIZiyCr8ZkW8eKUNZgQbv3S5n0l4EnzWwmAvwexoFds5B+WolvKvrcAYXRLXLkoyzop9KNQegVSmwxEfgj3lFj6TsnIPmAjyux44zYm9VDe2ORl5blaTQ2IwRY3iRVo3oRvxJD08gjLoD6A0eFXy+jR2mD140Q6tU4Oqfbkm9vBX9VKQqxGp0XXBitN3zEfA7d0CHcYK63qiDzhjF9GQM/X89wp1HK5jnl0SFVysG6LNjR1DMqjH4z+L/WtrTqt/px+jLgu9o149QLVeA/DwlRtxLopyeVCmcpyMwijh8oX9x59EKfuBfEm3AY0Qw7FrC7EIIWw+7KYhqxhPLYgDoDR5l2mLD9NqhErxdb8RZlY9+ue/fu9rSZZ4S3ciIaWzsnIN85zYo+EWMOowTJLW4/vrWMo3aQjRqC2Vny9zGDtO1Ez76subejo3vaXDRyqdxunbCR1KnUBlBMozuME5Qu35k/06Lsnbqs9kW75asmfZszW0xISllNNaAqyl3Qk6ycrqIVeFhcFVw7VlLLaRMeqU4LC0OsKKfmowclviooFrrtjjp41crUVtSIOrdDpxhlFAjlZV+1w4o1RyAQavCPL8kqCes5iJoakJPft0VK6Y4VpeySEhKCniCawmlsU0zSMern0GdmQUAqBTitx3CKcbPhzM3BTzrPsEG55XnOJTk58HtjWAjLH0QfRMnmVUspMQBux6Lj8ImONysLtZBrchBZZkaUS/gWV6TvE+qhikp/39ALVeAF8oLkZvDIFezgSkXn9bZYdIjQIhxTwBleg3MBhb+iRz03fUgk9iTm2jFAHGsDhvxuKSJrYyMjIyMjIyMjIyMTKr4D/LuL5nDuq63AAAAAElFTkSuQmCC", "heal": "data:image/png;base64,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", "shield": "data:image/png;base64,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", "evade": "data:image/png;base64,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"};

const ICONS = {
 ra:`<circle cx="12" cy="12" r="3.6"/><line x1="17.6" y1="12" x2="20.4" y2="12"/><line x1="16" y1="16" x2="18" y2="18"/><line x1="12" y1="17.6" x2="12" y2="20.4"/><line x1="8" y1="16" x2="6" y2="18"/><line x1="6.4" y1="12" x2="3.6" y2="12"/><line x1="8" y1="8" x2="6" y2="6"/><line x1="12" y1="6.4" x2="12" y2="3.6"/><line x1="16" y1="8" x2="18" y2="6"/>`,
 sekhmet:`<circle cx="12" cy="13" r="4"/><path d="M8.5 10.5 L7 6 L11 9 Z"/><path d="M15.5 10.5 L17 6 L13 9 Z"/><circle cx="12" cy="13.5" r="0.8" fill="CURRENT" stroke="none"/>`,
 thoth:`<path d="M16 5 A 8 8 0 1 0 16 19"/><circle cx="17.6" cy="6.4" r="1.3" fill="CURRENT" stroke="none"/>`,
 khonsu:`<path d="M15 4.8 A 8 8 0 1 0 15 19.2"/><circle cx="13.2" cy="12" r="2.5" fill="CURRENT" stroke="none"/>`,
 horus:`<path d="M4 12 Q 12 6 20 12 Q 12 18 4 12 Z"/><circle cx="12" cy="12" r="1.9" fill="CURRENT" stroke="none"/><path d="M9 17 Q 11 20.5 14.5 19.5"/>`,
 anubis:`<path d="M8 12.5 L6.4 4 L10.8 9"/><path d="M16 12.5 L17.6 4 L13.2 9"/><path d="M8 12.5 Q 12 17.5 16 12.5"/><circle cx="12" cy="13" r="0.8" fill="CURRENT" stroke="none"/>`,
 ammit:`<polyline points="4,8 7,11 10,8 13,11 16,8 19,11"/><polyline points="4,16 7,13 10,16 13,13 16,16 19,13"/>`,
 apep:`<path d="M3.5 14 Q 6.5 9 9.5 14 T 15.5 14"/><circle cx="18" cy="12" r="2.1"/><path d="M19.8 10.6 l 2.2 -1.1 M19.8 13.4 l 2.2 1.1"/>`,
 set:`<path d="M14 3 L8 13 L11.5 13 L10 21 L18 10 L13.5 10 Z"/>`,
 sobek:`<polyline points="20,8.5 5,11 20,13.5"/><circle cx="17" cy="9.6" r="0.8" fill="CURRENT" stroke="none"/><line x1="10" y1="10.7" x2="10" y2="9"/><line x1="13" y1="10.4" x2="13" y2="8.7"/>`,
 bes:`<circle cx="12" cy="14" r="5"/><circle cx="10" cy="13.5" r="0.8" fill="CURRENT" stroke="none"/><circle cx="14" cy="13.5" r="0.8" fill="CURRENT" stroke="none"/><path d="M9.7 16 Q 12 17.8 14.3 16"/><line x1="9" y1="8" x2="8" y2="3"/><line x1="12" y1="7.5" x2="12" y2="2.5"/><line x1="15" y1="8" x2="16" y2="3"/>`,
 hapi:`<path d="M3 10 Q 6 7 9 10 T 15 10 T 21 10"/><path d="M3 15 Q 6 12 9 15 T 15 15 T 21 15"/>`,
 nephthys:`<rect x="5" y="8" width="14" height="11"/><polyline points="5,12 9,12 9,8"/><path d="M7.5 8 Q 12 3.5 16.5 8"/>`,
 nut:`<path d="M3 16 Q 12 3.5 21 16"/><line x1="3" y1="16" x2="21" y2="16"/><circle cx="8" cy="13" r="1" fill="CURRENT" stroke="none"/><circle cx="12" cy="11.2" r="1" fill="CURRENT" stroke="none"/><circle cx="16" cy="13" r="1" fill="CURRENT" stroke="none"/>`,
 isis:`<circle cx="12" cy="6.8" r="3"/><line x1="12" y1="9.8" x2="12" y2="19.5"/><path d="M12 12 Q 8 14 9 18.5"/><path d="M12 12 Q 16 14 15 18.5"/>`,
 osiris:`<line x1="12" y1="4" x2="12" y2="20"/><line x1="9" y1="6.5" x2="15" y2="6.5"/><line x1="7" y1="9.5" x2="17" y2="9.5"/><line x1="7" y1="12.5" x2="17" y2="12.5"/><line x1="7" y1="15.5" x2="17" y2="15.5"/>`,
};
function HeroGlyph({ id, size = 24, color }) {
  const c = color || C.ink;
  const inner = (ICONS[id] || "").replace(/CURRENT/g, c);
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={c} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: inner }} />;
}

function Tile({ heroId, star, size = 48, dim, selected, showCost, onClick }) {
  const h = HERO[heroId]; const oInk = ORIGINS[h.origin].ink;
  return (
    <div onClick={onClick} style={{ width: size, height: size, position: "relative", cursor: onClick ? "pointer" : "default",
      background: C.paper, border: `1.5px solid ${selected ? C.blood : C.ink}`, boxShadow: selected ? `2px 2px 0 ${C.blood}` : "1px 1px 0 #0003",
      opacity: dim ? 0.6 : 1, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ height: 5, background: oInk }} />
      <span style={{ position: "absolute", top: 5, right: 3, fontSize: Math.max(8, size * 0.2), lineHeight: 1, color: CLASSES[h.cls].ink }}>{CLASSES[h.cls].glyph}</span>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <HeroGlyph id={heroId} size={size * 0.54} />
      </div>
      {star > 1 && <div style={{ position: "absolute", bottom: 1, right: 2, fontSize: 8, color: C.ochre, letterSpacing: -1 }}>{"★".repeat(star)}</div>}
      {showCost && <div style={{ position: "absolute", bottom: 1, left: 0, right: 0, textAlign: "center", fontFamily: MONO, fontSize: 9, color: COST_INK[h.cost] }}>{"◈".repeat(h.cost)}</div>}
    </div>
  );
}

/* ============================================================
   HEX FIELD
   ============================================================ */
function Field({ children, fieldRef, dropCell, onCellTap, highlightHalf }) {
  const cells = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) cells.push({ col, row });
  return (
    <div ref={fieldRef} style={{ position: "relative", width: BW, height: BH, margin: "0 auto", touchAction: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: cy(MID) - ROWH / 2, height: 1, background: C.ink, opacity: 0.4 }} />
      {cells.map((c) => {
        const mine = c.row >= MID; const interactive = onCellTap && mine;
        const isDrop = dropCell && dropCell.col === c.col && dropCell.row === c.row;
        return (
          <div key={key(c)} onClick={interactive ? () => onCellTap(c) : undefined}
            style={{ position: "absolute", left: cx(c.col, c.row) - HEXW / 2, top: cy(c.row) - SIZE, width: HEXW, height: SIZE * 2,
              clipPath: HEXCLIP, cursor: interactive ? "pointer" : "default",
              background: isDrop ? "#1f5673" : highlightHalf && mine ? "#a8331f1a" : mine ? "#0000000a" : "#00000005", transition: "background .12s" }}>
            <div style={{ position: "absolute", inset: 1.5, clipPath: HEXCLIP, background: isDrop ? "#cfe0d2" : C.paper }} />
          </div>
        );
      })}
      {children}
    </div>
  );
}

function Token({ meta, pos, hp, sh, mp, dead, selected, flash, ghost, onClick, onPointerDown }) {
  const h = HERO[meta.heroId]; const oInk = ORIGINS[h.origin].ink;
  const pctHp = Math.max(0, Math.min(100, (hp / meta.maxHp) * 100));
  const pctSh = Math.max(0, Math.min(100 - pctHp, (sh / meta.maxHp) * 100));
  return (
    <div onClick={onClick} onPointerDown={onPointerDown} style={{ position: "absolute", width: TOK, height: TOK, left: cx(pos.col, pos.row) - TOK / 2, top: cy(pos.row) - TOK / 2,
      transition: "left .14s linear, top .14s linear, transform .1s", zIndex: dead ? 1 : 5, transform: flash ? "translateY(-3px) scale(1.06)" : "none", cursor: (onClick || onPointerDown) ? "grab" : "default", opacity: ghost ? 0.55 : 1, touchAction: "none" }}>
      <div style={{ width: "100%", height: "100%", clipPath: HEXCLIP, position: "relative", background: meta.side === "A" ? "#cfe0d2" : "#e9cdc6",
        boxShadow: selected ? `0 0 0 2px ${C.blood}` : "none", opacity: dead ? 0.28 : 1, filter: dead ? "grayscale(1)" : "none" }}>
        <div style={{ position: "absolute", inset: 1.5, clipPath: HEXCLIP, background: C.paper, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
          <div style={{ position: "absolute", top: 4, left: 0, right: 0, height: 4, background: oInk, clipPath: "polygon(50% 0,100% 100%,0 100%)", width: 8, margin: "0 auto" }} />
          <span style={{ position: "absolute", top: 0, left: 1, fontSize: TOK * 0.26, lineHeight: 1, color: CLASSES[h.cls].ink }}>{CLASSES[h.cls].glyph}</span>
          <HeroGlyph id={meta.heroId} size={TOK * 0.52} />
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
const PACK_COST = 250, PACK_SIZE = 5, PACK_ODDS = [50, 30, 14, 5, 1];
const UPGRADE_COPIES = 5, MAX_STAR = 4;
const WIN_COINS = 80, PLAY_COINS = 25, WIN_XP = 45, PLAY_XP = 18;
const STARTER_TRIO = ["sobek", "khonsu", "apep"]; // tank · assassin · mage
const teamCap = (lvl) => Math.min(9, lvl + 1);
const xpNeeded = (lvl) => 80 + lvl * 60;
const upgradeCost = (star) => 60 * star;
const starMul = (s) => Math.pow(1.8, (s || 1) - 1);
let RID = 1;

const START = () => ({ account: null, level: 1, xp: 0, coins: 120, collection: {}, team: [], wins: 0, losses: 0, games: 0, shop: rollBazaar() });

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
const SHOP_SIZE = 5, REROLL_COST = 10;
const SHOP_PRICE = { 1: 40, 2: 70, 3: 110, 4: 160, 5: 220 };
function rollBazaar() {
  const out = [];
  for (let i = 0; i < SHOP_SIZE; i++) {
    let r = Math.random() * 100, tier = 1;
    for (let c = 0; c < 5; c++) { if (r < PACK_ODDS[c]) { tier = c + 1; break; } r -= PACK_ODDS[c]; }
    const pool = HEROES.filter((h) => h.cost === tier);
    out.push(pool[Math.floor(Math.random() * pool.length)].id);
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
  const placeUnit = (id, cell) => {
    setS((p) => {
      const units = p.team.filter((t) => col[t.heroId]);
      const occ = units.find((u) => u.col === cell.col && u.row === cell.row);
      const me = p.team.find((t) => t.heroId === id);
      let team = p.team.slice();
      if (occ && occ.heroId !== id) {
        if (me) { const oc = me.col, or = me.row; team = team.map((t) => t.heroId === id ? { ...t, col: cell.col, row: cell.row } : t.heroId === occ.heroId ? { ...t, col: oc, row: or } : t); }
        else { team = team.filter((t) => t.heroId !== occ.heroId).concat({ heroId: id, col: cell.col, row: cell.row }); }
      } else if (me) { team = team.map((t) => t.heroId === id ? { ...t, col: cell.col, row: cell.row } : t); }
      else { if (units.length >= cap) { toast(`Court is full — reach Lv ${p.level + 1} to expand`); return p; } team = [...team, { heroId: id, col: cell.col, row: cell.row }]; }
      return { ...p, team };
    });
  };
  const buyShop = (i) => {
    const id = (s.shop || [])[i]; if (!id) return;
    const price = SHOP_PRICE[HERO[id].cost];
    if (s.coins < price) return toast(`Need ${price} ◈`);
    setS((p) => {
      const cur = p.collection[id]; const collection = { ...p.collection }; let refund = 0;
      if (!cur) collection[id] = { star: 1, copies: 0 };
      else if (cur.star >= MAX_STAR && cur.copies >= UPGRADE_COPIES) refund = 20;
      else collection[id] = { ...cur, copies: Math.min(UPGRADE_COPIES, cur.copies + 1) };
      const shop = (p.shop || []).slice(); shop[i] = null;
      return { ...p, coins: p.coins - price + refund, collection, shop };
    });
    toast(`Recruited ${HERO[id].name}`);
  };
  const reroll = () => { if (s.coins < REROLL_COST) return toast(`Need ${REROLL_COST} ◈`); setS((p) => ({ ...p, coins: p.coins - REROLL_COST, shop: rollBazaar() })); };

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
        {page === "team" && <TeamPage {...{ s, col, teamUnits, trayIds, traits, built, cap, shop: s.shop || [], coins: s.coins, placeUnit, removeFromTeam, buyShop, reroll, goBump: () => setPage("bump") }} />}
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
      <span style={{ fontFamily: MONO, fontSize: 10, color: cloud ? C.mend : C.ink2 }} title={cloud ? "synced to cloud" : "local only"}>{cloud ? "☁" : "court"} {cap}</span>
      <button onClick={onLogout} title="sign out" style={{ ...press(C.ink, 1), background: C.paper, fontFamily: MONO, fontSize: 10, padding: "2px 6px", cursor: "pointer" }}>⏏</button>
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
function TeamPage({ s, col, teamUnits, trayIds, traits, built, cap, shop, coins, placeUnit, removeFromTeam, buyShop, reroll, goBump }) {
  const fieldRef = useRef(null);
  const [selId, setSelId] = useState(null);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null); dragRef.current = drag;
  const totalLife = built.reduce((a, u) => a + u.maxHp, 0);
  const totalPower = built.reduce((a, u) => a + u.ad, 0);

  const cellAt = (clientX, clientY) => {
    const el = fieldRef.current; if (!el) return null;
    const r = el.getBoundingClientRect(); const sc = BW / r.width;
    const lx = (clientX - r.left) * sc, ly = (clientY - r.top) * sc;
    if (lx < -HEXW || lx > BW + HEXW || ly < cy(MID) - ROWH || ly > BH + ROWH) return null; // off the player board -> recall/cancel
    let best = null, bd = 1e9;
    for (let row = MID; row < ROWS; row++) for (let c = 0; c < COLS; c++) { const dx = lx - cx(c, row), dy = ly - cy(row), d = dx * dx + dy * dy; if (d < bd) { bd = d; best = { col: c, row }; } }
    return best;
  };

  useEffect(() => {
    if (!drag) return;
    const mv = (e) => { const d = dragRef.current; if (!d) return; const moved = d.moved || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 6; setDrag({ ...d, x: e.clientX, y: e.clientY, moved, over: moved ? cellAt(e.clientX, e.clientY) : null }); };
    const up = (e) => { const d = dragRef.current; setDrag(null); if (!d) return; if (!d.moved) { setSelId((q) => (q === d.id ? null : d.id)); return; } const over = cellAt(e.clientX, e.clientY); if (over) placeUnit(d.id, over); else if (d.source === "board") removeFromTeam(d.id); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
  }, [!!drag]);

  const startDrag = (id, source) => (e) => { e.preventDefault(); setDrag({ id, source, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, over: null }); };
  const autoPlace = (id) => { for (let row = MID; row < ROWS; row++) for (let c = 0; c < COLS; c++) { if (!teamUnits.find((u) => u.col === c && u.row === row)) { placeUnit(id, { col: c, row }); return; } } };
  const selOnBoard = selId ? !!teamUnits.find((u) => u.heroId === selId) : false;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 16 }}>Your Court</span>
        <Btn small onClick={goBump}>To battle ⚡</Btn>
      </div>
      <Field fieldRef={fieldRef} dropCell={drag && drag.moved ? drag.over : null} highlightHalf={!!(drag && drag.moved)}>
        <div style={{ position: "absolute", top: 8, left: 0, right: 0, textAlign: "center", fontFamily: SERIF, fontStyle: "italic", fontSize: 12, color: C.ink2 }}>— rivals appear here —</div>
        {teamUnits.map((u) => <Token key={u.heroId} meta={{ heroId: u.heroId, side: "A", star: u.star, maxHp: 1 }} pos={{ col: u.col, row: u.row }} hp={1} sh={0} dead={false} ghost selected={selId === u.heroId} onPointerDown={startDrag(u.heroId, "board")} />)}
      </Field>
      <div style={{ fontFamily: MONO, fontSize: 9, color: C.ink2, textAlign: "center" }}>drag a god onto the field · drag it off to recall · {teamUnits.length}/{cap} deployed</div>

      <div style={{ display: "flex", border: `1.5px solid ${C.ink}`, background: C.paper2 }}>
        {[["Court", `${teamUnits.length}/${cap}`], ["Total Life", totalLife || "—"], ["Total Power", totalPower || "—"]].map(([l, v], i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", padding: "6px 2px", borderRight: i < 2 ? `1px solid ${C.ink}` : "none" }}>
            <div style={{ fontFamily: MONO, fontSize: 8, color: C.ink2, textTransform: "uppercase" }}>{l}</div>
            <div style={{ fontFamily: MONO, fontSize: 16 }}>{v}</div>
          </div>
        ))}
      </div>

      {selId && col[selId] && <Inspector id={selId} star={col[selId].star} inTeam={selOnBoard} onRemove={() => { removeFromTeam(selId); setSelId(null); }} onDeploy={() => autoPlace(selId)} />}

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
        <SectionRule action={<span style={{ fontFamily: MONO, fontSize: 10, color: C.ink2 }}>{trayIds.length}</span>}>Your gods</SectionRule>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minHeight: 52 }}>
          {trayIds.length === 0 && <span style={{ fontFamily: SERIF, fontStyle: "italic", color: C.ink2, fontSize: 13 }}>Every god you own is on the field — recruit more in the Bazaar.</span>}
          {trayIds.map((id) => (
            <div key={id} onPointerDown={startDrag(id, "roster")} style={{ touchAction: "none", cursor: "grab" }}>
              <Tile heroId={id} star={col[id].star} size={48} selected={selId === id} showCost />
            </div>
          ))}
        </div>
      </div>

      <div>
        <SectionRule action={<button onClick={reroll} disabled={coins < REROLL_COST} style={{ ...press(C.ochre, 1), background: C.paper, fontFamily: MONO, fontSize: 10, padding: "3px 8px", cursor: coins < REROLL_COST ? "default" : "pointer", opacity: coins < REROLL_COST ? 0.5 : 1 }}>↻ reroll · {REROLL_COST} ◈</button>}>The Bazaar · {coins} ◈</SectionRule>
        <div style={{ display: "flex", gap: 6 }}>
          {shop.map((id, i) => {
            if (!id) return <div key={i} style={{ flex: 1, minWidth: 0, height: 88, border: `1.5px dashed ${C.line}`, background: C.paper2, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: 9, color: C.line }}>sold</div>;
            const h = HERO[id]; const price = SHOP_PRICE[h.cost]; const afford = coins >= price; const owned = col[id];
            return (
              <div key={i} onClick={() => buyShop(i)} style={{ flex: 1, minWidth: 0, ...press(COST_INK[h.cost], afford ? 2 : 1), background: C.paper, padding: "5px 2px", cursor: afford ? "pointer" : "default", opacity: afford ? 1 : 0.5, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <Tile heroId={id} star={owned ? owned.star : 1} size={40} />
                <span style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: 1, textAlign: "center" }}>{h.name}</span>
                <span style={{ fontFamily: MONO, fontSize: 9, color: COST_INK[h.cost] }}>{price} ◈{owned ? " +1" : ""}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 10.5, fontStyle: "italic", color: C.ink2, marginTop: 6 }}>Tap to recruit a god (or a copy toward its ★). Collect {UPGRADE_COPIES} copies, then ascend in the Codex.</div>
      </div>

      {drag && drag.moved && (
        <div style={{ position: "fixed", left: drag.x, top: drag.y, width: 50, height: 50, marginLeft: -25, marginTop: -25, zIndex: 999, pointerEvents: "none", opacity: 0.92, filter: "drop-shadow(2px 3px 0 #0004)" }}>
          <Tile heroId={drag.id} star={(col[drag.id] && col[drag.id].star) || 1} size={50} />
        </div>
      )}
    </div>
  );
}

function Inspector({ id, star, inTeam, onRemove, onDeploy }) {
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
      <div style={{ marginTop: 8 }}>{inTeam ? <Btn small color={C.blood} onClick={onRemove}>↩ Recall from court</Btn> : <Btn small color={C.lapis} onClick={onDeploy}>Deploy to field</Btn>}</div>
    </div>
  );
}

/* ---------- CODEX (collection) ---------- */
function abilityInfo(h, star) {
  const sm = starMult(star || 1);
  const mag = Math.round(h.magic * sm), ad = Math.round(h.ad * sm);
  const fx = HERO_FX[h.id] || "nuke";
  let text;
  switch (h.aType) {
    case "nuke": text = `Smites the lowest-HP enemy for ${230 + Math.round(mag * 1.9)} magic damage.`; break;
    case "aoe": text = h.id === "ra"
      ? `Scorches every enemy for ${95 + Math.round(mag * 0.95)} magic damage.`
      : `Floods every enemy with venom for ${95 + Math.round(mag * 0.95)} magic damage.`; break;
    case "aoe_phys": text = `Storms every enemy for ${60 + Math.round(ad * 0.85)} physical damage.`; break;
    case "multi": text = `Strikes the 3 lowest-HP enemies for ${130 + Math.round(mag * 1.15)} magic damage each.`; break;
    case "execute": text = `Instantly slays an enemy below 30% HP; else deals ${200 + Math.round(ad * 1.3)} physical damage. Heals self 110.`; break;
    case "heal_team": text = `Heals every ally for ${140 + Math.round(mag * 1.3)} HP.`; break;
    case "shield_self": text = `Shrouds self in a 340-point shield.`; break;
    case "shield_team": text = `Shields every ally for 150 points.`; break;
    case "evade": text = `Gains +35% dodge and +0.45 attack speed.`; break;
    default: text = h.ability;
  }
  return { text, fx };
}

function CodexRow({ h, own, onInspect }) {
  const star = own ? own.star : 1;
  const info = abilityInfo(h, star);
  const c = CLASSES[h.cls];
  const ready = own && own.copies >= UPGRADE_COPIES && own.star < MAX_STAR;
  return (
    <div onClick={() => onInspect(h.id)} style={{ position: "relative", display: "flex", gap: 10, alignItems: "center", ...press(own ? C.ink : C.line, own ? 2 : 1), padding: "8px 10px 8px 12px", cursor: "pointer", background: own ? C.paper : C.paper2, opacity: own ? 1 : 0.82 }}>
      <div style={{ position: "absolute", top: -1, left: -1, ...press(C.ink, 1), background: COST_INK[h.cost], color: C.paper, fontFamily: MONO, fontSize: 10, lineHeight: 1, padding: "2px 5px", zIndex: 2 }}>{h.cost}</div>
      <Tile heroId={h.id} star={star} size={46} dim={!own} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 15, color: own ? C.ink : C.ink2 }}>{h.name}</span>
          {ready && <span style={{ fontFamily: MONO, fontSize: 9, color: C.ochre }}>↑ ready</span>}
        </div>
        <div style={{ fontFamily: SERIF, fontSize: 11, fontStyle: "italic", color: C.lapis, marginTop: 1 }}>{h.ability}</div>
        <div style={{ fontFamily: SERIF, fontSize: 11, color: C.ink2, lineHeight: 1.25, marginTop: 1 }}>{info.text}</div>
        <div style={{ fontFamily: MONO, fontSize: 9, color: ready ? C.ochre : C.ink2, marginTop: 3 }}>
          {own ? (own.star >= MAX_STAR ? `★${star} · MAX` : `★${star} · ${own.copies}/${UPGRADE_COPIES} copies`) : "undiscovered"}
        </div>
      </div>
      <div style={{ width: 48, height: 48, flexShrink: 0, backgroundImage: `url(${FX_KEY[info.fx]})`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center", imageRendering: "pixelated", filter: "drop-shadow(0 0 1px rgba(20,18,12,.7))", opacity: own ? 1 : 0.55 }} />
    </div>
  );
}

function CollectionPage({ col, onInspect }) {
  const ownedCount = Object.keys(col).length;
  const roles = ["tank", "fighter", "assassin", "mage", "support"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 16 }}>The Codex</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.ink2 }}>{ownedCount}/{HEROES.length} discovered</span>
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 11, fontStyle: "italic", color: C.ink2, marginTop: -6 }}>Each god charges its one ability from attacks and auto-casts at full charge. Numbers shown at the god's current ★.</div>
      {roles.map((role) => {
        const list = HEROES.filter((h) => h.cls === role);
        const c = CLASSES[role];
        const ownInRole = list.filter((h) => col[h.id]).length;
        return (
          <div key={role}>
            <SectionRule action={<span style={{ fontFamily: MONO, fontSize: 10, color: C.ink2 }}>{ownInRole}/{list.length}</span>}>{c.glyph} {c.label}</SectionRule>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {list.map((h) => <CodexRow key={h.id} h={h} own={col[h.id]} onInspect={onInspect} />)}
            </div>
          </div>
        );
      })}
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
  const SZ = 54, N = def.frames || 1;
  const dur = Math.max(0.34, N * 0.045).toFixed(2);
  return <div style={{ position: "absolute", left: sp.x, top: sp.y, width: SZ, height: SZ, marginLeft: -SZ / 2, marginTop: -SZ / 2, zIndex: 12, pointerEvents: "none",
    backgroundImage: `url(${def.uri})`, backgroundRepeat: "no-repeat", backgroundSize: `${N * 100}% 100%`, imageRendering: "pixelated",
    filter: "drop-shadow(0 0 1.5px rgba(20,18,12,.8))",
    animation: `sfxframes ${dur}s steps(${N}) forwards, sfxenv ${dur}s linear forwards` }} />;
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
    const t = setTimeout(() => setSprites((p) => p.filter((s) => !ids.has(s.id))), 820);
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
