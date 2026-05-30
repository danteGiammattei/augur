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
    @keyframes sfxenv { 0%{opacity:0;transform:scale(.55)} 14%{opacity:1;transform:scale(1.08)} 78%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(1.18)} }
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
const FX_SPRITES = {"nuke": {"uri": "data:image/png;base64,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", "frames": 8, "spin": false}, "venom": {"uri": "data:image/png;base64,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", "frames": 8, "spin": true}, "solar": {"uri": "data:image/png;base64,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", "frames": 8, "spin": false}, "claw": {"uri": "data:image/png;base64,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", "frames": 8, "spin": true}, "storm": {"uri": "data:image/png;base64,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", "frames": 8, "spin": true}, "execute": {"uri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAaAAAAA0CAYAAADMtuy4AAAPIUlEQVR42u3de1CU570H8O8Ly96XxQUWcUEQRAFFAkHEeEGlag1Djpe09Hg5MaeGnsyko206mXHSdM5JxumcTtKkmZM5nZpOtU1THVKr40gbjUcSooDcghdQVOQa5L7LZZe9sL/zB4VERVgQ5N2X3+cvZ/d1eX7vvu/z2+d53ud5AMYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjjE2/OBwhKcWzCIeJv1XGmCQtxG8lVcGlIW/C8RyMrKJt6iJJnYetqkJOXGx2k9qvN6nFk4RcSkKuxzGlIW9Cx4u99ZPhU0A5xgraqS+ZdZW1jKsnJnUaBHA8IqaABkV4VvDk2M2yLylAJUd9r3jjqcZewdNjM+WXqNNhxu/a1giz8d7kBMQeEo+jVIUXJHFDrMF5csLu0XEA0IcuVOB7Asfz5Fo/dvSPe1y27jI9/1Q4zDYnfl96zeOEJWZ7DWWkV/nhTPMzszL5cAJiD1mBM5LqBtgYE4Zzt5rGPOYvq76mPrsLAPDH0lscj8haPzv1JbQ+JgRKP18UV7dIIvmkIY/a++w40vX0rE0+jD3ktYjrYyagHGMFnd7QRjnGCtEnqlfDr9HByCoaK5a7u+zU+uIgHU5poM2yL4njEZc4HKF05PNANmOzweGUBnpU5XZ2Uwc17nHSodgar6gQ3k2oHbOcZzLa6e4uu1ckUynGw5gPnwLpi8dRWoEzNF732iuhlWRzDo6alH61LRGpCwwoaejE6zcWzUi3QY6xgg6YrnpcudZ3PXps4dcJd0ju64M/Xa7D79qSOB4RtnykdA9K7TFzTkDMY1V4QdD6+CNSFzzmGE+oXoWatp77XjsUW0M/SJ8LX60LuWVN2P753Bmv3IYH2MdT1tw26usfJNXRysgg1LT34he3FnM8IpOEXFJCI6l78Db+g8d62ORbEGnIo8lMLhOT4VZQPI6OGsdo3W9fZpqpcY+T3k+8S2L7TsY7JgWnHjpmr6GM3k2opVfDr3E83PqZsEQc45aMN3k55KtRv7B05It6MtloMnwK7ivvtyvlNOTRg+97m8MpDfT2ktsEALsDSun9xLuPHE9IQi55Umk+SVPxA0FMkzylEk868ilbd5kfJmAPmfYuuF0pkSMV9XAyytZdpi1xJvgj2KtO1nn30GSxLX4XKX9LN72wNhwAsENTTPFBcyVxQWQnR+Dspg7anhgGg1o+6njCcOIR01yhnfoS+n7C4sduZdTgJYHjmVqfY52gU8iwOiqEa1x2n2mfB9RptWNXSgRe/I6DAOB/3wGylprgGHTjc6zzyn7Rn6xfjPRdDgCduNlmoytfmwEA3ysIFW08r4RWUqJpDl4qnT9Sxjeiq8nucuNX9UsEALjR2oMXf6jFnAYtyOGDyhvWUT9rphNPjrGC4kL00CpkI/EYtUpsXDwXB7qu0nvNCYIYyy31ePabrlB4gBr2QTesjkG09tjwYUeyAAAfdiQLWb3esy5YpvwSAUCnwwwL2ia0ugETUQL6R1ULVkcFQ5vUDQAw/8hNgy7gD0W1XnnCdupLaJ6/GsDQWiDR62yY3+6Pjlty5Gu7ad3f54juQk3FaQrVq/DduFCc0Nyj6tYepEcbEWPUoa13AApZNb11J054p3GpYPhNDcWF+GNDrBGJsWrgjLhiScFJAoCoIA3WLQ0E0EAvlc4X3mtOECJu1lLOqmhY8yvIW54Ek1o8D4rDERquvE/bVwreUmYAOOPw/hUKFuEwiaVVP5ppL9jbS27TvtVR0CZ1w1c7NDu7r2IOdO/Ive7LfS3iOq2JDsa6pACoFvbBV+ccec/t8AHZfSF72SAA3/Tf96BdVL9U87d0U+oKOVQL+wAA/df1IIcPrF2+eOsf1/A/LYkCMLTmVuYSE3rtTpTUd+Kk7f7KYxEO0/CaZDO51Mvw4PvFxgYU4Vlhq6qQHizrgz8grA4XxjpmJkktnskmZQU0uIiN3OqQuGn/ghv3OCl0VQ+cXXLI/J2QBTjRVzEHuQWt+Li0Dk3uW7iBfxf1hZbhU0Dp0UakLQjEygR/yAKH1uLyVQ7Czzj0757iQORf68R/XbiIcmwXRTxJyKW5fvMQHaRFpEEDucwX25aFIWT5UPLxMzhQc9of1+9ZUNvRh/M1rfi7c9WEyp6tu0w1vfXoh3laxhvicZTCZdFIDjMgKkiL2o4+/LIuftrPbzyO0gJ5DPx8hSmt3KUUTwpOUqgiBDqlDB9blnt1skjEMarEDySR8MTe6pn2BPRyyFcUoJJD5eeLn+0Kg2phH1xmPwCALGCo1VB0XImVp/WiP0k7NMW0bVkYnjLNQXioHJr4HvjqnHC2KYYq8X8moC8+liM9T3zdb7sDSik7eT42blJBpneOtNoGe/3gaFWgt16JkD/4jpQ7FafpMrIETy7wJOTScuPCJzLx8WBkFT2XYEKX1QGX243KJjO0Shl+ejV6Wv/2uwm1dPzqjSlvyUolnixFIemUMty23MNlZAkJ+DP5w4gIfQAG3YTjvalP7J5YiN/S48y3ScYJGu3HYxyOkBxKzESCetyYxJ6cprwgK3CGkkNMCFDJoVf5Yf+euVDOHxrMHuwbGnLy1bq8IgHtN12h6CAdYkN0sDkHsSF5DtRLLPCRu+FsU2Cwzw9+wXb46pyiTUDDrZTdyyOxJiYI+jXtAABnlxxuqwwDdzXILWvCh6VXUYxMYYvfRdqeGI7K5u6R7rixrMUFem5JOOQyX9S09Xj0fx5HjrGCwvRqPD3fgJT5BnzyVSPO3WhBk60VVlimpFIdbqVsjgtFqL8K/3pxnsDxTMxOfQkFaxX4TfMySbQqEnGMHBjghxG8rQtuWO+rDlIu6MMv3r430uXwHZ8C+sztHftg7NAU08rIQGQnRyAkqf+fCdUP18vd6LO7cOVrM0L9lShp6MK5+qoZGRdZiwuUHj0Xi43+MOoU+O/PqtHirr2vEjuRfo8ylgWhxzz0QNKcsEF0N/nieHk9fnZ94chxr4RW0oZFISiq68Tn9XUoRua48eQYK8hic07Zr96tqkJSy2Xo7LejzdUy7jnNMY4/WB+Po6SAekLfz1RtbSC1eLIUheQYHESnqwOl2Dpj9/E2dRHFGv1xrcXiNQ86sCeYgHKMFfTG5qWwOlxYfFzldRdIEnJpeNn4N6KrKeeZhQiKG4CrU4FTl9qxu9A0EtMqnKOZGjx9LeI6LZsXgHs9NtR19Y/aGtmqKqTMJaZvklZ0MExRApprCZ9UNuKTG5X3VUqvRVwnq8OF9j476nrbPUpEj3utBKoVcAy6ERagBoFQ2tA15hjDDk0x/VtqJNR+Mmw8Gzhu+dKQR4HyAPQ4bChAhkfxpCGP7OifcIUttXj2BZVTsFYJx6AbFpsDjWYrPnWtFsZrgd/rtU77tIssRSG127sntF1Dhk8BWdxdKMW/iLZemupuODF5IvsBOVxumG0OVDabvfIk2WEduVHfuhMnpMxvpU0xWpRX96OkoRM7NMX01/4VAoAZfXLH6nChqK4D1a09I5NmH3TStlLoKr1AoToNlpkCEKCWA3AiPM6N5xGOkvpOVNi+Ob6ssQtPmeYga6kJ9d0BWG6ppOnqZjtgukoHN8VDa3Kg+poLvzxXheb+zjErlDU4T88/FQ61nwyFdztGXs+UX6JHPUZbhGeFnaoSWhERiO3KWvrJ1ahx45nMHjRSimdfUDltjgvFhkUhUIba8WmBxaN1AbN1l2n5fANKGjA8c2HaTKT1k2OsoGCtEu19A6LfjVTK68g9kcVIj3Q9LRwrb8AXd9q88iQ92A+vV8rhq3WisduKay2WkV+UM13OkpYmlLQ0PTL5DPsC64XjvanC/9W0wmx1QB5qg8zgQHicG3aX+75jz7vXCHc6hmqO55aakBYZNK0xKLUEQeZGa+8A/tq/QhivonTCjuK6TryXf3NkIc4Pkuro55uXYKyVpj+2LBcqvzZDLvPBqfWtE1qVerbFk4Y8+umGWGRm+MOwvh0DLQqUNXZ7fl02dE26WzYFJ2lfUDlNVRwZPgW0Q1NMqxYEw+2mCT9A4+3rQTIv92bMTXL82kynN7TddyGKbV200ewOKB11S4azmzro7KaO+xYc9YZ4HtV9dWp9K70Zc3NC5f8gqY7MP3LTqfWtxPE8bL/pCr295PaULHq6L6h8wknlcEoDlW/rpfwt3ZP6+2nIo/2mK7TfdGXSazaOthjs40rGiUl95lQs2CqmdQ+Zh3bqS+ijlc2011DmVV/eodiaUW/etbhAwNCyPN9+PQm55K3bc3u6vcGDDpiu0k59CXE802uvoWxS98/ByCp6N6GWEvDnSSchsbVg0pE/4TJJba8kNkHetur1XkMZ3cy2UenW3ofK/UpoJX20spmGE9G3eWsCYuI2vPyQVDzuZnNpyCMpJhVuYbGRhHkotmbUrRW+zDTTifR75E3JNg15NNlKTIw3hdTiYYwxj/QdHKDRNqIblq27LKp9jnZoisfsVvKkO0NM+1BJLZ7ZhrfaZmyS3k+8S/RR65gJCBjqihNDJXfAdJV2aIrHLIflx65x4wGGxlUmO7bC8YzuUGzNuJvOSa37jT0eHz4Fs9NeQxk9syAITZ8aUNk89iO1xcgUZnLF62EGtRzN/Z2PfP9gZBWpYnrRZ3eN+1lO2GHUaGf0sVopxbMvqJzC9OpxJ5tujlrs8WfyYDsnICZRgRoFdAoZ/naladrXb5sqTRbrIydQblUV0urooR125bLxL+siPCu09fdxPFOovKlrzPfTkU8vpC7AftMVjxKLEpoZS6ivR1Vz8uMExKbLV83dQ0vvVNZ5TZnHmjS4dqERITrlyIK3nihAhtCDdo5nCnzYkSyMt/Dopth5iEwdwNLQAI8+c6Za3Yk4Rs1m67R8No8ZMSYxb8bcpLu77FT1fSsVZlmI4xGfE+n3yPqf/WT5sWtKJrOKwWTnAibi2BONX8xPSnILiHm98qYufHazFc1mG46XN3A8IrNNXUSxIf6Qh9hxp8mGdxqXev3aZq9HVdOe1AWT+r8ODDzRsk73/j88FYDNemtwftwnyjiemZGlKKTCLAv1/9xGno7/iFmm/BJdyrKQ4/1urngZY8wbWkFSGdjfpi6i8m291PlDtyTi4acNGWOMMcYYY4wxxhhjjDHGGGOMMcYYY4wxxhhjzGv8P0taG6OHIwsaAAAAAElFTkSuQmCC", "frames": 8, "spin": false}, "heal": {"uri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAaAAAAA0CAYAAADMtuy4AAAhRklEQVR42u19eXBTV571udLTbkm25V3Y2BiCDQbihAQEmNjFFsAkmSZdZIGkXT0ZqqsDTaeykKKnKbrC14ROdTNJpmboTMrTCZ2E6qzEhGwUDpshMG0CTmwWgzF4t2xLsvYn3e+Px3vWYhvZSHjhnSqqjPT0dO/Tvffc87u/BRAhQoQIESJEiBAhQoQIESJEiBAhQoQIESJEiBAx3kDERyBivKDwzRV06iwZJBJAzTBwsCwu1LDweSmqn/1CHOsiRIgEJEJE9DDzL8vp1EI5jFoljBo10tXqoPd7PB44WRZNdgdaHS58UPTZqB7zWRuKKQB4en1g3X50vndMnKMiRAISIWI0kU7B/XIUGhJxjyEJOrks4s+et1hQ2dKKlnYPujopmv7Zi8Y3Kkd0HiQ8aqLaDAVAMeJtueW+rDZR/u/uj6rITa8NvILe/DOjvd9jtf0iAYkQcRPkv7KUFixQoSBJj1ydFukq9ZDIJ5CE6q02bC14Z1SM/8kvL6KX/nhQaMuULYupPksBl4WF9Zobnl4f3FY2aHHL2lBME6eo0NPgQsOfD42aeTzUhTiUhLo/HH0LeMJqE42kPyIJiQQkYhzjiWMP03mpKcjUaJARYmobLgl9Wtk5qs6HSvc/RH0shdsFOB2DK7S8bUuocZoSPpai4ZR9VBBRpIv1WFI2IqGIBCTiDsfSj1fRp2ZnYapeL7y2/UQNtswtuOlnt5+oCXvN66F4fFbWiCihhNUmKlNL0f7uUeF77359OS2YrcCTuZPwydVGWN1e1FV7cGbjgaC2TdmymGbOVCFOR6BQcW9dOONBQqoUvVaK6yesaC0/MibmdcJqE5UwBH4fHdPmN1H9iAQkYhyj4NVldG5xHNbnTR2QUACEkdHNCIoCuGCx4JOL1/BTlQu1v/s65vMhdKEq2LmM5t+vxMzkeDw4wYjLNhv+68gVVD5eMWhbTOWldM5MDTrdbrg9FG4nxYXvnYhLk+P0+v2jZl5nbSymKdM1IBLAY/fjh00coRrWzKMSGQHr9I+pRduwZh71+2iQqXAo514iRAISMUaQ/8pSqkuXYcOS7IjPeyJVRYFodjhwzW7H0ZZ2/PCd87YQEQCsPf4I/c30aXCwLP50og6bTfnYfuQn/OLebABAi8OJyivtsFm59U0TR5CfHod0tRr7qtuwfn423qy8giNr+8hq1q7l1Ofxo+bFr0ZkbhvWzKMAYN57nGRtLKapMzTQxUuE9zubWLgtLBxmL+xtHpj3Hg9qZ/La+VSmknK/y1uHR9Y55AaxqBJlUCYwAABXNwu3lQ1q92BmutFETqPRnCgSkIhRi8eOPEwXpKcgXx8vkE+o+tkytwA0CoOZJ6Hjbe14b37sXbULdi6j5evvBQC4fT7sqKrFZlM+AMBHKVqdTjT29qLT5cZVmx1paiVaHS7MTU2GmpFCL5cDAHYfa0BJQSK+rjYLRFS0p5QGktJILzy5mxfRxFwlAMDZxaLrknNAcsndvIiqEhg4u1kAgPW6Cx17jommOVEBiRBxe9XPrx+biDnJyQNeQwG0OBz4z6p6AMBTs7OG7RnH47zFgh3vX0LNS7FVED+vfJi+WDgd247WCMQTSD6TtFq4fT68dqoWbheFQkkQp5VgYVoqCg2GoHsda2uHmpHivZNNWFmYjL3ftQeZ4W7XItgf0c3atZzKVBIQCUD9GNA8yLuiN75eSTKeWUhVBhni0uTobfWg54ozTCmNFDKeWUgBwNntHdBjTzTJiQQ0IjsdmZozHQQeLo8FGNcvpMoEGaifwucR5g5c3V60/W1k+rL64EN082xO3RCEm9Z48jlj7sKXp7pQVVZBTOWl9MmidGRqNEhXq4c9uHfXnUdjkwdf/+zzqPa9YOcympAhg9NO8fCCJCxMSwUASEnf1yikUlSbzai32tDkcODMUWeQOe2vl9dTvVyOSVpt0L1f+vIcHrsvA3q5HBcsVpzt6EHt9y7hsynrFtBYjUvDmnlUoWPCFuWsjcVUZ1RAqpCgt9WD+h0HB/3+5LXzqW6CEvU7DgokBABOs3fEzXGD9XOsqp/RYJITCSiKSFm3gCZOVsFt48wHV147NGqfb+7mRdQwmTOLWJs8AvFYr7uEaxilBOokOaRyAmc3i6u7YtefrA3FtPGNSlL45gr6SHESVmROAND/mU6zw4ELFkvYTp/HnLdX0hVzDMjVaTFVrwcFsO3wOfzb7FwAQBwjg1YuG3Twn7dY8MW166g+dOtnQmllRXTCXB28Tu4Qvvj9UvqropwwEqk2m1H+XROqyioEBwVtcp+a6250Q5shh1JFsG6eEXq5HBaPBwCCVJGDZaFmuDOL//jxJ+yZ92nMfjeeNADclGAiXQRzNy+igaST8KiJjrSXXKzacKe7rTMibYQvFioD91j8LIa06La/e5Roni+hCi0Dt41FWlkRHWmX2NSnF1BNqhxyjVQgkbxtS2jaXQqo1ATNV1gwSgkcne5+402yNhRTdZIMUjlB6tMLaKwUkfGeODQCeKQ4Cbk6raB8QsmHArhmt+PDY+Hkk7WhmBrviUNVWQXx7V5JV80Hpur1uGCxwOsFHk7fRf5UV0ZVDHNTlTRVr0ePxwPvgnbU3mLfJszVIU5HULme8wB75N40gTgCzWhnzGZUlVWQvG1LaEKWAl5PeBzQ8s9W0c52P9493oR184z44FQz/H4KfVGfKtpxtBZbiqZBIZXiN9On4cxOJ42VU4JuglIwlQ1GUgN5u4W+Zlgzj4YSWaDaMKyZR3lz3O1UGMMJkB3qYjweyGio7ZeIlNOHnOdLqMrAQKHl/qkSGGRtKKYJj/bZdCOFQsuAJ7KRwsRNJQL5KPQMUgvUQvCiIUUChZJAESdBzUtfkYGCHRvfqCTObhZyjRSaVHnM2pqYRLCt5inKq5b+GsOb3S5ZrLB3smFEK1UQQT2cXr+ffH7MDAqg3mqDzcL9hC/klZN3v2vGoeYWfN/RgWaHY8A2ZWo0KEjS31K/sp8roXE6IniCFe0ppWpGKiiWyzYbjrW143RnJ/7X9AkBgLqt35Cqsgpyev1+0vhGJZn88iJh/DkdFEkpEhxZW0HKv2vCzMlqzMnXocXhxO8rzwEAthRNw46qWrh9PjhYFvn3K4X2BN7rVsGfh/S2euA0e4X/hy6qkbpaJ6w20aGc9fD3DDxzudXdezSuGQqZqBJlQf2JVl/GCkQC6oc4AMBtY+G2sSBSAoWWQcq6BTSSweE0s4IJbqShSmAE5dPb6kH3FTeM05Ro+okzs1l7KLqvuG8uk5USKPTcvWKF9BS5YDIbCDaPF9fsdlSd6Q1zEkicooYmOZggT6/fT149XQODUgGX3S+8fvKX+8m33/bg3e+accFiwUA/aoZajVyd9tYI6D7ODbnlug8AsLTQAAfrE0xuLQ4nPvq+FXXnvAPew3zRISQpbThlR08XRd62JbSqrILsuncvOXjSgtOdnViWn4pOF/fbbjblY0dVLaSEYGZyPO5+fTkFgEt/PEiGs6EabIzx5jL+zCaUJCLdFUdyXShBxcIkFo0d/oBu2SHPnnfvjlV/RAIaI0hZt0AwnbltLJxmFldeO0Su7jpE3FaWi9aOYGgEmtz8I8xDPg+Fo9OLq7sOkfodB8nF7d+S+ESC6QtU6OmiIBLg4vZvg3qVt20JnbVrOb3/f1bSKVsWUwCQSDmlxLvGxgLF6WmDkg8A9LJeOFkWJ38ZbHrLeb6EKuMZ2DvCzUA2C8W+s62Iiw8e6jUvfUVO/nI/2ftdO1ocjgFJKF2lRuGbK4a1YGc/V0KlDEFzow9Tp8tQtKeUpqqUmJ+aIlyzr7oN9+ZrBg0e7f6witiauY1Cw58PEVuHFy4LG0S0e+Z9SvYea8U1u114nSehBycYUTBbIbyuTVdE5TfzOn1wdrNofuswyd28iNbvOEj4OKBoImtjMe3v71giZkqE9sVKjRfcyrMSCSgAXZecuPLaIXLltUMkkEi6P6oine8dI90fRiaR/SyEhX+k+pL69ALq6PQEnR9M2bKY+ligp4vCx1Ic/Dnn5TVxUwmduKmETtmymCblKJCRwyAjU4rpC9VYffAhmnW3CtYmT8z689iRh2ko+QyU7eCFvPKwNmiNSmRMlCKvKE547a7fL6ZLP15FlSqC1qssLB2+fu93ev1+csbchZYBTHE6uQyPFCdh5l+WD3mSxWdzajNnKoMkhQLPFucEOQvo5XI8dl8GTp6133RC8zvjpCfmU+s1d79536rKOLOcQiqFj3K38LEUl202PJk7CaX7HxJKPfCKaiiLTOjuvWPPMVK/4yDJ2lhMeecV897jUTEjBd5DZ1Rg1i7u+afO0ISRULRUA6/WAr872ua97o+qiELHCOZKVzc75gnpVp5/zAlorNg0vQ5fRO7TkaSYd1tY2FrcI9ofZYIMrMsf3LYchbAoXfvBKRBVb4sbrm4vHJ0eXPunHeYOP3q6/EIEfnwigXGaEnnblsTkt0xTKyO67q+n67H041XUVF5KC99cQYv2lNKZf1lOs/NkkDIEEgkXPwQAGflKNF/0oKHOi+w8GbLzZJj5l+U05/mSsD58eaoLNq93QBVkUCowtXDo519dF52o2/oNcTspTp61hzkeWDwevHu8SXA8yH6Oa5tUMfi0dJi9SHpifphJmDfLVZvNaHU64aMUv7g3G/915Ao+udoIH0sxZcvi4TnGkIHntK3ZHRQsGi1CSF47X3geMpUEuZsXUV28BCnTNbdtUY3WuUzgM3F295lbBevKHQrRCy7Kk0aqkMDP0lGZVt7d64fbJYHDTgWX2f682q6Cc4XNnKVCTxdHQPGJBL67FPDeMLVEq02Fb66gRk1kma23LpyBCzeyWBuUCuw724qEPO7cYVKKCpfbncieoUDq+6W0rd6D7BkKyOREeC9zMoNmmQr5ryylXRcdQt+ryiqI9uNV9JVFM/r93kyNBkatcsh949Vnr5WiqqyCrLnwr8JKc9lmw7vHm+ByUiz/bBXt6aKwdUiQtaGY8uY2frEPHJuDFahLyOI2GPVWGx7NycZlmw0AUPl4BUk78jB1uwD9jWs8vb7h/2gk3EQYi/nIL/y9rR4k5irBZ1MgkrG5NgQ9rxtqcrQE2I4URBNclOHz+OF1+EZl29wWFjYLRVuN46bX1u84SPiEmN2dFD4WUKkJ+NihaEEqI1Axke2DCDj36OWZE3DoapvwekOdF5fbnfCxFD4f4PMB8UY59zdLhff8fqCnwQmpjECdLBPMUKbyUvrU7KwBvzeOkcGoGf5Z0LWznNosNCQC4JwPLB4PXE7Oo83poGg5Z0fNi18Rh9kbpICGsvh5PRQFO5fRJocDbp8Pjb29aHFw311X7YHTQYWzI9btH3pHbvReIiX9Wjaibe3g+16/4yChAc312P1Ruf9A7R2tbt2iAorC7mE8p6lIWG2io2VgSeUEuglKtAW8Vrf1GzJly2LKOm9OkHzMz8Gff06mbFlME3IUcPf6oYiL7p7lrgIG8fKBzVuBgah8DZ/Pj5mFQ/ulH6+imZMZeD0c+YRmL1j68Srq91M0nHOHBZSayktpI4Ani9KRrho4JkgnlyFdrcbUWTJUD6OPvKPHJw1X0epwgZES7Jn3KcnbtoSeeuaboK+NpAT3QC6+7TV2GO+Jw5mjTrxmq8XU1Dicb+sFAJzZeIAEnvsMudR3QBCmn6VgVJKgmJxYz+fT6/eTgleXUY9dImTUjhb5iPna7iAFxB/0jccfezT1iUi4poQeNnvsvrCzof7AuvyYuIk7k7i4/Vvy/b/uJz63H9YmD4zrF0Ztp6seQP3wpBMYiBpKPgDQcMYJey9HMHysTyCcDgqng/abzaCqrILMeXslzdRoIsofJxnibAndYTfZXHD0UtScdgeZzPjfKVIFEbape9REJ7+8iPImv5oXvyJuF8VVm104x+NNgsM1vQV+Z/dHVcTvpTGNC+sPXZeccFvYcTVfE1ab6J0W+yOa4O4AuLq9N1SQol9yuak0VoYPDet1N3weCmWCLGrtdLDsoOqHR7PDgS9OmsPclS/84VtS+XgFSc2Vg+mnWawXaKv3oPj9UnrX7xcHTfTZu7mUPekRVldVM0MzGCh0wdd3dfhx+Zwb6RODX5/88iJqa3EPa0FMWG2i2nQFAkt6A4BCSfp17nBbo7OAm/ceJ2qDrN/g01ih+a3DxGH2RsVrLJRQ+9sw3M5N651KQjEhIJ7Vx8NDHat9aNp9mOiMckgVEgTG9FzddYj0Ry79EVBo4Cm/w6b+6D0S/yBcGKh+rtntOPnL/cRUXhr25fmvLKUqNYFKHb5+a/UE2TMU6Gz0IvtuVRD5rJrP5YsjgxBfpGTZH+Rx0iAFam7h0h4plAQFO5dRXvlc+uNBEmq6HYoaCnS1727k1FWcVoJWhwuaOBKzXb9CzyBxsuq2jmt7mwcSGYnJedNoUUR3EgHF5AxosOJMY8X0lrDaREHG/mFhRg5zI5W/Cln/WEUP/vxzEkk+N0YlRepUJaTbltC6rX3nFNbrrqgqoPM/eHFvsmPQINTzFgv+fqSFI9Z/9iLn+RKqSZbD3uFBXlEcJBJwbtgsRf4rS2m8kVNDKjWBTHbjPbkEShXB0o9XUa2e4KXZBUPKxNvj8eBCTWQElPTEfNr53jGiy1RAmyxD4uvL6ZmNB8gvHjTC6/fBlJKC/9aex5mjTqQUaNA4DPNQ0hOci3Lne8dI9nMlNPs+DVRqgs52P/56eT3lCNOHFq0D+8DFgIUGHd8KZu1aTpOMDKw9fszevZLGqgpr6JrBxxlJGDLm1pShrpeiArqDIVNLIZWP7cdjvuSC00EhZYCEJG6MF79fSnM33zwfWGqBGlo9gUIfWz+V6me/IE32cK88XoXwDeVzvDW+UUkcHV74vBTx2SqBfCalqCBlOLWjUAJS6Y1/N97LzpOhoY6LvyiZmIoD167j/CBpeELhZFn4vJFdzdzwYlPqGajUBHk3YojS1SpkxcVBIZXCqFaj5sWviEwe+doTujtWG2Qo2LmMps/oIx+likAvl6PQYICakQrmxcyZ0VUqck3f3CASzm0/Fjv4gRKYCrEzMVi6o5mqaKhKR0zFIwJJT8ynEobA546tu2esUb/jIGm94EZPF8WPR52ITySQMgSZs1S4/39W0ombSqhx/UKa+vQCalgzj6Y+vYAC3GKi1hAhWWms0WRzDfr+O6cbEWh6a/vbUVL7u69JT4MT1y4FqxLeUaDy8QrScM4tuGELROKgePvLJnx5qgvvnG7EtsPnbtq+ZocDTXYHqp/9IqLFQR7HmS4tjW4olIBOIUPx+1z701QqXLbZhBxzvMkscKzwQaa8yhlocWp8o5L0tnrQ3ejGgYc/J3yZBj4rtl4ux77qNpjKS2mcrn+nlOGCd4vuqneB+oG4NPkN5SyJyXgPIwUa/fvzZ0uqBFnUSehOdjQYNQQ0VthdbZBBoWciynpws3ulrFsgFKobCdRt/YY0/eSCcRp3IK3VEcQnSmBIliDzHg3USXIoE2SIS1cIgZmZszg1ASAsWSmjlMDV7Y1qG89Xe2D19H9PAuDXplw8eF9i2HtXXjtEzv422CXX6wWaazlCq/3d18Tv52KBGuq8OPvbA+TI2gpS/ewXpKqsgnz9s88JXyNoMNi8XrQ6XEPu18Xt3xIpQ/AvE7Pwq6IcpKlU+NOJOqSpVCg0GGAqLw0yb/JzpPO9Y0SbMXi+Nn5z1PDnQ6Ru6zfEVF5K+RpBgVg/PxtzZmqgUBHkbVtCE6dERwm1/2iHtceP+h0HidfpF9oTrfLZgXMree18Gvo8or2WSKQkyGlEFWBmjlYmBP4+IhmJCmhATNxUQtVJMkiYCAfVo307Vv71tLIimvN8Cc15voTe7kPa/vqjM8rReMaJjxbtIz8edqD5mg/NV1h0XnHj4vZvydVdXNJVAFj0j1VUypAbaik4WSlXG0ge9SqpZ397gPzT3CmQUKATwPYTNUhXq3G3IRGzd6/s32xh9uOnqw64nBRf/+xzcuEPfW2uO9KL5qs+2JrCCeRPdWX93i+0BlHF1ev4oOiziPvc+EalEHNTsXIf+Xv9ZUzSaiElBJtN+ZASArfPh7IHjOjPqSL7uRKqy1QIsTqD5YbjMWemBh+cag5K97P7WAPerLyCTrcbV86zME5ToqfBFZXfrPH1StJ2jsth98OmA8Ta5I4qOXR/VCUkNtVNUKLx9UqSu3kR5dPzCNdF6YzWvPc44TNTN791mLitbNTjg0I9726no9ZoJT0xFU8oIwc8kYgKylFu98ToGEzcVEL5zweWdRjJEt2qBAbuXr+Qb2qwg+gpWxZT6ufOi3486oRxmhJTtiymfh8F6/JDlRC74VJt7kK6Wg2dXI8tcwuCSIgASFerseaBFEjfXkntnWxQOYbeHj/WzDUGZUfgoUmWw9XDhlWnnfP2SqpiGMQxgztUnLdYYOkauilWIuv7uprTbnypb8LJhm4AXJZqgEvxs2Z+GnKPP0LrznkFF3OlnoE2WYbs50pow58PcWro0YGDnGfvXkkVUin8Ad6Jx9raUVKQiH+f/jfiemslzciSwtrj7zeJaaQLWJgJ8PU+77vAv6MF897jQpbtjGcWUq70w+2xJpj3HiexOgsaCUvQaLU+iQpoAERaUK77oyrS/u5R4raxoD4qFLPjyWek4bH74LawEcX+JOQooIvnxilfNyghR4G4NDlUCQw8dl/MSjLUfO9BvdU2YIE4AuAuvR7rHsjA4sXxmPN2nxpSaiQwu9x4aXZBmEqyd3jQdTH4ngWvLqOmu+OQqdFAO0gAKp954eIJx5D7Y2l0CcXfzmw8QM529OCFuXlCiQQASFIq8VVtG2YnJWHRHD02/d8aypvl4hMJsu/TCIrKMGXgWKW8GVymhl8Vcdm2X/ryHNSMFF9XmwEA6RNukM8pe1R30ZHE4wylgFt/1/KF7lQGWdTHXuj3uULuPxDhD6VPY5EURAIaQQy3oFz3h1w8hrObDaspNJL9sbd54LH7hOqu/V2TtaGYFry6jHLJSinM7X40/eRC3dZvSFuNA24LC4/dB3tb7EoynP3tAVLTaRHq2YSawQCuQNz9yckoyUjHugcyBBOaVk+EeJ5V8w0CCZnKS6nPTcNMhpokBpP1ugFLctMA8tla8A4JDfKMdDwEfq72exfUDAOFVIrNpnxsP/ITAOAPxTOQrlbhZK0VZy85UPaAEUV7Smlnuz8orunSHw+SrA3FdPbuldRUXkr5zOSm8lI6OykJX9W2Cc4Hj92XgfdONuHIWs5z0NrjR6+VDlv9DNeUY1gzj0ZaCZVRSfpdkPlCd7yTQ/Nbh6M2/kIzXTu7vBH1P5oF9u50EhJzH/UDPmW/Qsug65JzRE1o0cDETSVUlcDcKFDnCVJDugmcc4JUTqAzcpPcfMmFaGa8jhT5ryylhSUqrMicMGhcEAVXHbWX5RaMv56ux9aFM0ACiOOLk+awwnW8uWrNAym4S69HRkgGhMC8c19cu45PKzsj9nyLBGuPP0J/M30aAC6oNTCzQrWZUyt6uVwo0+ByUtiaPUEpe2wdXtS8yJkfTeWltOwBIzI1GiQp+7IeXLbZ0NjbixfyysmsXcupTCXB9RNWDKsMQ6SkFBAzxyuW0DE03Jgd3sXbet0VNSeHWyWX4T6b24mxECMlEtAgSFnHuSV7Hb5xs1NJfXoBDQwklcoJiITA1e1F0+7Do6KPSz9eRbOMcjw+aZKQoy2QHCJBs8OBa3Y7/n6kBVVlFcRUXkofvC8RdxsSw5QPf296Y0LsOF2DjxbtI9EcR/wmpmDnMpp/vxIzk+Nxl14Hi8eDD04149UHg0tBXLbZYPF48G+TdgvtKNi5jN69QAXjjVLhhQYD3L6+3G7bj/yEzQvycbi1DZ8d7YRKQ9Dd3EdYsQRPOrzZjK+SGglp5G5eROPS5OByDbqDzpMSHjVRVYIMbis74qULhuKUMJraPZpJTSQgEaMSBa8uo5sfn4x0lTqiRKED4bzFAoCLJfq1KXdAsxuPkx0d+M8PrvabvDSaCxevxPZXd+CJOUY4WF9QqW5eFR1ubUOvjTONKpQEz9+XD4VUiss2G9JUKkgJd8sdVbXYbOLe21n9I/5R/NltnduGNfNofI4KcWly9LZ6BBLK2sjVNxrMgYJIuLgir9Mflul6tO3iI8nmz5MPEF2ToWiCEyHiNmLO2yvpugcyMCc5GRTA/4tABfWnlGjAYA/N88Zfa/V4UWvpwdGW9iG5XA9351i0p5TyZzRFe0rp0kIDDtV0Yf38bABctVQH68OJtg6kqZVodbhQV+3Bk0vTkBUXJ8QU8U4NPPkAQNnu/7stqicUyWvnU96kq0pg4OxmBzTlZjyzkCZOVkGVyJkhu+pHxuwbC/UjQiQgEeMA+a8spbMeUGFBegrmJCcP6bNDMdlZPV60OB1445sGWFu8UVU/Ayq8ncuoVB5c26ZoTyl9tjgHu4814KHCVLQ4HKht6YW9l6NQrY6gOCcF6WoutoxXQDuqavHC3DyoGQb/8eNP2DPv0xGd13yGbK/TF2Z+M6yZRzWpciHYO8nYdw5m7fGj7Zwdja9XCjFAo8F8FZHqCdlgGNbMowodAz62yNXNCk4O44nEblWhigQkYkwQ0TSTEptn953TBBJNKEKJZ6Ds1vx1u+vO40Rlb1Bs0e3A7N0raZyOQBcvQct1H6ZOlyFJocDJs3Yh991AKH6/lP6qKAeTtFp8eb0JZzt6UPu9S1A+o3HHznu7+b1UIJZZu5ZTuUYC6ueyK8QinmgkyCnhUROVSMkdX3JbJCAR4wbbap6iuTrtoB5yQ1VG5y0WvHO6MayS6u1AWlkRnTBXB56Emht9yJnKwO2k6LVSXDvrDAscvvv15TSvUA6dQoZ/mZiFv9dfRs1pN85s7FNSKesW0NHkOMN7gkmkBH6WjjsFMN5UjUhAIkT0g8I3V9BHipNwqyQE9HnJHW9rx3vzPxvRecCXU5AyRIi/6u+6rA3F1HhPHFRqwmX8ZggqVu4bt3N4PJRaGM/9EQlIhKiEhgj+vKfeakNNpwU1R5235cwnUiKKz1ai66ITgUXmElabqELHQB4nhS5TAaWegaXRHaSOJr+8iA4nYDbmi25gOhsauVIYC8piSG7ZIvmIBCRifGDyy4volLlq6BMlKJ04AVqZLCyoNJBwelkvrtntMLvcUQ8uHUmklRVReZwUthb3mC+cGLqoj3byESESkAgReOzIwzRNrYRRo4aKYRAfUo6g5UYtnyabC+erPQgt3zDWkPTEfMooJELNoUClJEKESEAiRIwACt9cQaUygrsKGKgZBg6Whd/PlfweL4pHhAgRIkSIECFChAgRIkSIECFChAgRIkSIECFChAgRIkY7/j8LD863L68uHQAAAABJRU5ErkJggg==", "frames": 8, "spin": false}, "shield": {"uri": "data:image/png;base64,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", "frames": 8, "spin": false}, "evade": {"uri": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAaAAAAA0CAYAAADMtuy4AAAXnklEQVR42u2dW2wU1/3HvzM7uzu7M3u117u2wTd8IZg4IcWFRG7ruN1UdlOrqLVMechDCZZioTxYoRWtqNRGahuKKKoqUkElHoJSEEREqIUHIotUNIWES2NMwBdsLsYX1sveZj17md3zf2hn/jY44ea92D2fF8Bedn9nZvb8zu8OUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCj5x7p168hSWk9DQ8NTrYeljwSFQqFkno0bNxJBEKjymQVHHwsKhZKvNDc3k9OnTzP5LONLL71EBEFAKpVCb2/vvLL29PQQi8WCcDi8KJRKX1/fI13zR30dtYAoFMqiw2Qy5eyzu7q6HnrCX7t2LWFZFhzHQafTzfuaH/zgB6SoqAgAkEwm89pi6evrY7KlfKgFRFny7Nq1iyxbtgwbN25kFqP8HR0dRK/Xg+M4EELgcDjAcRwcDgcqKirw+eefY3BwEMePH1806+vs7CQ2mw08z6OgoAAmkwkulwsWiwU/+tGPGADYsGEDcTqdmJiYyImMGzduJN3d3XjxxRfJiRMncOTIkQeub2trKzl58uRDr3s4HMbZs2cRjUYhy3LOlM9CKIyFhiogypLm9ddfh8FgwLvvvkveeOONRaWEWltbSXFxMTiOg16vBwCsX78eZrMZqVQKdrsdoiginU5j06ZNRJIkSJL0pW6gfFE+brcbDocDBoMBdXV1MJvNEEURanykra2NiKIIlmVhNBpzIuehQ4cY1W1WXFw8770RRfGR3mv2/Vi3bh1pamoiZ86cyeo9epjyyZWCoi44ypKlu7ubWCyWnLs+Hhev10va2tqIau0oigKDwQCn0wmz2Qx1TRzH4ZlnnkF9fT1KSkrg8XhQUFCQ19bcqlWrYDKZIAgCCgsLYTabUVBQAEEQIAgCDhw4QFauXAmLxQKGYXLqghsaGtKus9frneO+Ug8Ej8u5c+cYq9X6wPvlmlxZR9QCoixZCgoKMDY2hrt37+LGjRuLQubOzk5iMBjA8zxMJhNisRg4joPBYICiKLhy5QpsNhsURYHRaERtbS0qKiowOTmJRCIBu92O9vZ2kk8uOa/XS4qLi9Ha2gpFUdDX1we/3w+/34+BgQHYbDZ4PB7U1NTgxRdfhMViweXLlxEIBMDzPHbs2EFu3ryJsbGxrFp3H3/8MURRxO7du5mWlhbi9XqJ3W7HkSNHGI/H88TutFgsBp7n4fV6iSzLyLY1lE8wdJuiPC5vvfUWKSoqwvDwMPbt25eXz9DWrVvJmjVrcOfOHVy7dg3vv/9+3j/rHR0dpLi4GCaTCVarFeFwGLdv39ZO4YT859CsWgWpVAq1tbWYmprC9PQ0AIAQAoPBgHv37iEUCuXMHafGroLBIDiOg9vtRkVFBX7xi188kjwtLS3EaDRCr9fD4/EAACRJgizLOHbsWE7v5ZYtW8iKFSsQCATwzjvvPLUszc3NBADyPdvvcXhUlx61gCiPTX19PcrLy+FyucDzPPnjH/+Yd1+cV199FY2NjTh16hSGh4cf+vrXX3+dGAwGhMNhHDx4MOvr8Xq9RK/XIxaLwWazAfiP21Cn02nWkMFgQCgU0txyiUQCV65cgV6vB8/z4HkeiqIgHo9DFEUYDAa0tbWREydOZH09iqJAURQ86WfPVpzNzc3EarXC7XbD4/HA6/WSU6dO5eyZ279/P9Pa2koW8lpZrVbkIjaUKfr6+phHUUI0BkR5bGw2GywWC1avXo1vfvObeSffgQMHyMsvvwy73Y76+npYrdaHWkvNzc1oa2vDN77xjazL29LSQux2OwRBACEEiUQC6XQasVgMBoMBFosFtbW1aGpqgtPpRDKZRCqVQiqVQjweBwCIogiTyQSLxYKSkhKUlJSgtLR03gB6NuC4hTvbnj59mlHdXRaLBY8a/M8kJ0+eZB4lA+5RUJVOLuNduYJaQJTHRt30BEHAs88+m1eydXV1kZqaGm0DrKysfKiM9fX1qK+vh8vlysl6eJ6Hw+GAKIqIRCJIpVLazyORCGKxGPR6PQoLC1FRUQFZlhEIBLTXybKs1aDwPA+3241kMolEIgGHw5H19Xi9XmIymRY05fjUqVNMW1sb0ev1qKysXHLfqVgstuTW9CguOGoBUR6bSCQCnudht9vhdDqxc+fOvMnoEUURiUQCkUgE6qmyubkZALBt2zayffv2B2R1uVwwm81wOp1YtmwZ3n333aytx+v1au1ZFEWByWSCyWQCy7JgWRapVAqRSARDQ0O4cuUKysvLUV9fr2XCqdYGx3FIpVKYnp5GIBBAIpEAy7IoLCzEli1bsnp/9Hp9RtKnT5w4wUxMTOCll17C5s2bl1RPtd7eXiaRSFALiJJ5hoaGSE1NzaL19VZXV2sFhCzLorGxMS/k2rp1K/n617+OcDiM0dFR1NTUwGQyobq6GpIkkXg8Dp1Oh7feeovIsoxoNIrx8XFcu3YNQ0ND4HkeLpcL69evz4q87e3txOVyIZlMQpIkEEJgMpkwNTUFQgji8TgEQQDDMAgEAjhz5gx+/OMfw+12w2KxIB6Pw2g0ory8HB6PB36/H1evXsXg4CBEUdSKVsvKyrJ2D9TkgWAwmJH3P3bsGNPe3k7UONlS4n8xG45aQFnm2LFjZLH7esvLy+eccgsLC9HT05OzE+mmTZvItm3byJo1a1BUVASO4xAIBObtu6XGTURRRGlpKaqqqsCyLKampnD58mUMDAwAQFbWo7rNCCEQRREWiwXRaBSSJCEcDkNRFJSVlcHtdmuvHRkZwdjYGJLJJIxGIziOw7179+D3+yHLMhiG0Yo6dTod7t27h0AggPb29oyvp62tjRQUFIDjOC0pIhN88cUXmJycpJsJVUCUx2H//v1k3bp1YFkWu3btWpQuhA8//JA4nU5wHKcVd4qiiGXLluVM+aiKRG3vEovF0N/fj4sXL2qvUxQFkiTh1q1b8Pv9SKVSMJlM8Hg8KC0thaIouH37Nq5fvw6z2YySkpLMux/+ew0tFgvcbjcEQYAsy9p15ThOy34jhCCVSiEUCiEajUJRFCSTSciyjEgkAlmWYbPZsGLFCqi9yVKpFGRZhiAIyIbF0NzcjOXLl8PhcMDhcGgxqoVG7ZxAWfxQF1wWaWhogNls1qyIxcRf//pX8sILL2DFihVIp9OQZRnpdBqKokAUxay6eWajWg48z2vWwMDAgFZvMjMzQ4xGIwwGAwDg+vXrcDqdmoLhOA5VVVWaglIUBYIgaLUnmUav18NsNsNgMECSJCSTSSiKoqVa+3w+yLKMWCwGk8kEjuMgCAJcLhdu374NWZY1a7SqqgpWqxVTU1OaSy+dTqO2thbRaDTjB4GqqirNnRgIBDLmhrPZbGBZNqMFt+vWrSPnzp2jdZJUAS0Nzp07R+rq6uDz+TA4OIjR0dG8lfXChQvkueeegxoUVTdvzWxmWej1esTjcfh8PoyOjuas00BtbS2+//3vo7q6Wr3O8Pv92u/Pnj2Lb33rWzAajfB4PPD5fIjFYigtLYUoilqMpKSkBH6/H5cuXcLRo0cxODiYcdnV9PBAIIBAIKBljRUWFqKurg48z+PcuXPaPWBZFpIkoa6uDk1NTbhx4wY++OAD+P1+JJNJsCyLsrIy1NfXw2w2Y2JiAteuXcMnn3wCSZIyupZAIIBPPvkEw8PDT9UYtaOjg7Asi3Q6jWAwiPnqfXp6epj29nZy7949urE8+uE3L5uRUhdcFvj444/Jc889p/nxp6en4fP58lLWo0ePEjUV2WAwzNtDLZFIaD9X40Bq1lm2sVgsKCwsnGNl1tTUaP/u7+/HxMQEZFmGz+dDPB4Hz/OaeyoSiSAcDiOVSoHjODidTkSj0azMbXE4HFoDTlmWNZeV0+nEqlWr8Pzzz2PlypUoKSnRkhEmJycxMjKC4eFhjI2NIZVKQafTwWQyIZlMwu/3Q1GUOZ+juuoyiaIosFgsT539xvM8bDab1u27o6NjXlf1vXv3Mhq0f9JebxRqAeUdTU1NAACGYcBxHGw2W942x1y1apVWTa9uWmq22+wNTUUQBFRWVuLKlSs5kTcSiWB6ehp2u12TdXbtS39/P4qKimC32xEMBhGNRrX05lAopG1mRqMROp0OFosF5eXluHnzZsZlT6fTMBgMmnssnU5r19fv98NoNKKsrAyhUAhTU1Ow2WyYmprC8PAwpqam5qSa22w22O12mM1m+Hw+BINB+Hw+EEJgt9sz7oI7deoU4/V6ycOKfh9GLBaDxWKBIAjgeR4ejwcdHR3k/nEImc4YW2oZaflo/VAFlEH+/ve/k9ra2jmxBLWtvt/vx549e/Ligdi9ezfp6emZI0s0GoXP58Pk5CRsNptWYT/7936/X7PiWlpacraW8fFxnDlzBolEApWVlVrQXsVmsyEajeLu3buYmJjQFFUsFtMs0kAgAIPBoGWV8TyvKYNMoipOnU4HQRC0eTGTk5P47LPPtNYz0WgUiURCcxnG4/E5BwT1ngSDQc3aUWuBnE5n1qzTGzduzDmoPAlHjhxhOjs7iaqArFYrWJbFhg0bSK57wFGoAsp7duzYQX7yk5/MG5SfmZnB+fPnsXnz5rz5IomiiC1btpD9+/czAHDp0iV8+9vfhk6nQzAYRDgc1upNAGBychLf+9738kZ+nU6H4eFhDA8Pw26345VXXoHD4cChQ4dIUVER1q9fj7Nnz+Jvf/sbbt68iVdeeQXqdErVKlDjK6oyOn36NP7yl79kfI0+nw88z2P58uWQJAkMw2gKZGJiAhMTE9Dr9ZqidDgc+OEPf4ixsTF8/vnnAP4Tj/N4POB5XovZqcrV5XIBAAYHB5GNfnBDQ0MoKytDZ2cnOXz48BN/3uHDh5nu7m5SVlaGsbExXL16FTqdDp2dnSSdTs87HC6D3osF68+2ZcsWsmnTJpw5cwY3btyA3+/Hhx9++D+tVKkCWmBUS0HNZJqtfCYnJx+pMWY2CQaDc07Sly5dQnFxMTwej2YtAP/ffufOnTt5JX9hYSGMRqMm3+joKFiW1YpKL168OMdCq6qqIgUFBXA6nWAYBnq9Xst+U69HNuNzasGoIAgwGAxaxtv9z08qlYKiKGBZFoIgaHN/QqEQEomEpkT1ej2i0ShisZjmKlWvTaYxmUwoKyvDzMzMU7/XxMQEeJ6HJElaUkNbWxuxWCzYsmULMZlMMBqNiEaj2Lt3b8Y28ZKSkgXLtgsGg7h8+TIkSYJOp1syykcd9f0kbj6qgDLgErp79y70er1WqyBJEnw+H/r7+/NKAXV1dZH7Y1G7du1iOI4ja9eu1Ta5WCyWs1HCX8Vrr72mNfFUN9pQKIRIJILbt2/j3Llz+O1vfzvnS/H73/+e2b59O6muroYgCOA4TtvE4/E4otFo1lxWJ0+eZJ555hmiujkFQcD4+Lg2A0hVPOqfkUgEg4ODiEQi4DgOJSUlCIVCWvsdtQA1FApBlmUtMSFb8UY1hlZWVoaenh6ye/duBsC8MZyHMV/HgxMnTjAtLS1EFEW43W7U1dVBlmXs3bs3Y2uy2+24e/eu9u/29nbCsuwTKY//XgOSTQsuk8pjNk/6/6kCWmD27NnD1NfXa5k7al2Eunn8+c9/zouHb+fOnaSxsVHrMTab3/3ud0xXVxdZu3YtampqEA6HtThEvrB161aipl7zPA9RFKEoCkZGRtDf3/+Vc4rUBAO32w2TyaTFUyRJQjQaRTbHF/h8PszMzGiWs1rXo87/kSQJHMeBZVnNRadaNHq9HizLIhwOQ6fTafOC1GJWNUMum6MLIpEIiouL8eyzz2Lbtm3kzp07T1w0evz4caatrW1OFlxvby/T3NxM1AORw+HI2HiG1tZWEgwG5ygbj8cDQsgTf2Y+KR9VcTQ0NJCnSdN+GuWVdwroN7/5Dfn5z3++qE3T2W1gbDYbXn75Zfh8PvT19eVctuvXr5PZRbDxeHzewPG+ffuYffv24bPPPiPxeHxOau/s020u6OnpIS0tLXA6ndrIAnUN//znPx86JE+NZ0WjUZhMJnz3u98FAPj9fnz00UdZXct7773HJBIJsnr1am0NgiDA6XRCFMU59VVGoxEWiwU6nQ7j4+O4c+eOFsdKpVKIRqOIRqPweDxwOBxIJBJZqWdSKS4uxszMDP79739rQ/FUBbpp0ybyJEMB5zsM3D+4rbW1lTQ3N5OFHujW0NDwQDbkvn37mHwbp70QSihXn51XCmj37t1k5cqVi/6GqsPAdDodzGaz1lLl7bffzrlivb8Dg9/vf+gANnXDVq2F+wtTc/CcMIIgkDVr1qC+vh4zMzOIRqNIJpOa2/CrWLlypZaIYLPZtDqioaEhjI2NZX09hw8fZnQ6neZOVHsFJhKJOXU18XgcX3zxBZxOJwwGg9YFe3ZvwWQyibq6OrjdbgwMDGQlm0/F7XZDkiRMTk5CkiTNjabX6x+oTVpI1C7iC834+DgOHTr0wHdDTTnP1HqampqIwWDI2TTbbJJXhajf+c53lsRFLS8vR0FBgZbCDAC3bt3KOznT6bRWC/NlJJNJWK1WlJaWaokJmdxMHpW3336b+eijjzAzMwOz2QxBEGC327F+/Xr8+te//tLNYfv27aSxsRGrV69GTU0N7HY7JElCX1/fI1lPmeL9999nRkdHwTCMVgAcjUbB87zmnlMLgAVBQGFhIQwGA+x2O0pKSlBRUYGKigoUFhbCarUiFArh+vXrWXX5eDwexONxTE5OamOzFUWBTqeDKIrYsGFDRjbtU6dOMQzDoKWlZUHff3ZHjfk+M1PX0el0YvXq1di8eTNZyMmr+YAac8o7BXTw4EFSWlqa8ZYhmWbPnj1k5cqVKC4uhsPhAMuyOH/+PNasWZMXp5lLly5pp2JZlh86udJoNMLpdMLj8aC4uBgWiwW7du3Ki7Xs3buX+fTTT5FIJOByuVBWVobGxkZ0dnZ+6f9Rx4mXlpbC5XKBYRicOHECH3zwwQMJC9nm5MmTjM/nQygUgqIoiMViWLZsGaqqqrTnSRAELfaj0+nAcRzcbjeqq6u1jgkXLlzAP/7xj6wr05GREUxMTMzZnJPJJAghKC0txfPPP//Y7/llnRDuJxdjxzPF8ePHGXVAnSiKWEpKSI055Z0LrqGhAZIk4erVq4v6AqvZYzqdDrIsY3h4GF6vN2++HI2NjUxvby9Zs2aNply+irKyMi0Inkwm52QE5QNnz56FzWZDU1OT1qyzuroa4+Pj5OjRo3jzzTeZ+xWQmsIbDAYxMjKCN954I2/uz7Fjx5gNGzaQyspKuN1uuFwumEwmmM1mOBwO3LhxA9PT0zAajbBarfD7/UgkElAUBYqiwO/3ZzQt+at45513mPks6HQ6DY/Hg+XLl+O9994jiqJAlmV0d3d/qZxvvvkmcTgcj+USXWiXVS5dzbmyxLOlhNS/58Uit23bRhRFwR/+8IdFfdGHhoaI0+nExYsX8a9//Qu//OUv83o9Bw4cID6fDz/96U/nlXNgYIDYbDZcuHABn376KX71q1/l7Xp27NhBWlpatC7X4XAYvb29+NnPfqbJ3NPTQ1599VVcvHgR165dy0qx6dPQ3d1NZs/UYVkWgUAADocD69evR11dHQ4ePIiRkRFIkoSTJ0/m5Xra29vJunXrUFVVhXA4rI2UiEQiGB0dxbFjx5iOjo4Hxnh/WTPSbMm80J22165dSwDg/PnzWV9TppqRPu370tYWC6hEX3jhBdy5cwfDw8N5k279tOzcuZN8mYLK1w07FoshkUg8oGBee+01YrVa8ac//WnR3Ju2tjZiNBq1QlRBEGC1WlFSUgJRFHH27FkshhY1HR0dZPaQOjVpxOFwoLy8HCaTCaFQCH19fVpdVi77sS1kB4Rc87WvfY0kk8m87AdHFRCFQskZXV1dpLq6GpFIBNevX8etW7eW5GjqXM4XWrt2LcmF1UUVEIVCoWTZciosLNRid7du3UIwGMRC1yhRKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQqFQKBQKhUKhUCgUCoVCoVAoFAqFQlkS/B/RIJ93uWfSQgAAAABJRU5ErkJggg==", "frames": 8, "spin": true}};
const FX_KEY = {"nuke": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAEnklEQVR42u2aXUxbZRjH/+85pS0FCt1I+BAMc85GMEGcojgTXeIyXaYXKnHGC5fFC7wwAU1M8MZwBUEvRlwWXSYzMcELG7lZICbGbTpgY3YbccAUYYMihYWPdqX0tOW8fy8oi3MwJ0k/WM/vpufiJM95Pt7n6y1gYGBgYGCQFKwfXmSyv8GULMFq8xCXIzLpTlCSJXjP0/ko2pGTxvF/ZIRGEjAwMDAwMDBIO/JeOc28fafSsxHKeauHtrr+lFE+4cNQuCwbusOcMg5J+DAkrSqKS2zpawBF07HHaUdNlzd9h6GGQT8HKNkRiLK0YzyphhDJEuyW5FZB/EmBj7u8uOieh2khDJlpgrSqMHuXYJ4Iwte1W9xXR2CV97q86F3U8cu1IK7eCAMAosU2bNu5BdsrcsEMJe7KJzUCACDz/V8pohJLX1QLAMg+2MdQeR4AQP/oUZGW+cH++s/MebsnvbdFadslGhgYpN9kmJaKmxsHUqbUJb4TPDLCmhcKsLzFkhLlMeH7ALttRWTo8yfvqdNTm4cIVSBzyAff1zVi00dAcCaEUPTeboUtx0ZZXekATQoW46B80ij85jotx0b5X0fF6fJQbR2+PxOlvf0arfXuNZUr7RhnohYmcT8ClmOjrLvsY/n3k7cpFL00B5MvsqZhDlQ5MDit3R9ebvOG6JZk97Jk9cmpu3rV6fKwYdDP2t7ZhIV93CLgpZ9u8PibpcgyK2g5N4eXTYrwa/pKVl+DT0YX2bK/GHarih+uBja350s7xumW5Fhs7/fvJchaHWD3suQAJY/PhZnIf4/EpQ8osmdgqyAyADyUdbuIteq/td7NfEUgF8RjDjOe35GDMwkyQNxq6xglLQCCAB4Rirhbo+NqcKLasvLKPADX2BLaz88hqhPPlGVheEbD72+Uik2VA4KxXxk7Euu9R4uKArOCKIBxCrQPBfBl7yw88xE8/oAN9bvyceK1ks13j+CW5AQlOzWdqxVhvQSIIyPr3g/U9s7SLcmOQJTmxoHNYYSWiSVekGSbN0Sny0MAaPUssWHQvyEFOjWdnZqemgbI23eKpqYrrO2dZUcgyguS/IOSpyVvtbtOl4fnJFcy/AZo84Y2bLy45wBf125hWgijvMCKimwVBYIwAZgKLkP3hgAASxEJCaDMYYbT5WH2wb7/pcz1+Qi+Oj+fumVQO7xTNB0Guk9O8YkSGzIzBIZnwlA0HQDw17SGCzMaKguseLUiF59Oa8gJ9zDw7a47Mvsh9wIDYR3fPZsvAKCmy8tJfxQ3D20TKWuAVfr3F4v+2LOtrp9qhoLsg31c/MApjj7o4YEqB5YlYbeZsF4IvFuVh3xBPOcNcWBKQ2WxFWevBTdfHwDErrqcudAbywX+UQ5nfvMh0ly5puwfJfmwIKYpsCCJhZCOS5MhjMyGkaEKlBdY0bQ9W6RkBNxh3aiE02nH3kE/J/3RW2F9N15UhKjtnWVAk5jwRRCIHaOKwky889QWFJkV3Bz08+iJMYQ/q0r9JYnaOsw2b4inYxNh3WUfTU1XUqacJcSCavMQqysdMKsCZ/YWpuetr4GBgYGBQerxN/8wPa8pw11HAAAAAElFTkSuQmCC", "venom": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAKGUlEQVR42u1abWxT5xV+3vvljxgnJMYUXBNIRoFlGWsL7ZqBTD2qAPno1EmISePHhNSlVSqqrlWqSUiV+ieIagIVqRUT6g+mtZ008QMYZaW0qIiqoh9UgBgtCTQmOAQnxIntXN/re89+BKeOP++1b0Kr9vy0rt+Pc5/znHOee4CfbPbNs62FvNvX0ffxbNxcbBJ55yxz1ApY8coT9KNGQuCf7fTQG21FneDrClApNC3asZ5+UAhIm5IEbHZW9JnBN08XfaBqoYRFa9xYvmsj/eAc8MmfjrJYJFXRGoKdwyI/h1UtTktCqiIHFCO2QsSXiCgVHbhv9ynG8wz31UmoWijdGwR4t68jz7YWGj50hhUjvnxOUuKaqZjPZ0mZMJFUoSX1uXdAY0+QHLWCoWeHD51htmp+xiVD+2fGeKmYz2eJGGE8qiMlz7ED1h5oo4ZHqiC5hek3XHIDnsGz0gl/d8Ay5pYnCZNxgnxHrXgtwczD/gYeS+Y7MBwyTmTf7vuIeQ+0UU29A6Eizz11spNcVTwGQykMXJhE9Lo8jaLsZzUNiMcoJ5xm3QE2G8Ov6urwybyYufSX0KFr+QGw5UgHbW32o8E9D8dDN3AtGYUynkIxfklGU5iIaznh1Ha0gzpWLcZIUsapi6P4YOsRZqkDRiM6RrwyXPPMUcdXzx9njT3BHA+0He2gFx5dCbck4u9XvsaX5ydx7uljJQ8dCyeRSn63XPOeTbRklYhn1yyH12EHANTZ7IgdbKNPdxRfzzQBPXmik1Iq4eL7E/h230eG/+/vDlDmG9typIP+8uuVEHkO/7jaZ/jy6aySRkjznk1U6xMg2RgcTga7g4HnAUUh3BrUEfo8VvScglkHXL+swlnNQ7CbQ4GeRRtbm/1wSyKODoQMX96zrYV0Vc8h4JuXZSjjqZyLLnvx8dnpPep3biB/d6DsDq/zeCedi/6Vjg29QL/9V4ehNfLt5e8OkJHsUqzWyIuA9YfayeliEETAXT31pofD+jSppD2drvaKEVY+EyVgXFHxdn8/hvqNVYb59khGNRjZu1itkeOARw+2kXcxB0limGcT0eL1osE9D+e8tyEc7qCbV1VceOk9llntLdqxnsIHPzbsBHmScH50BLfCGi69fIKVgyKzexpygL87QKoCDPRpUBI6OF7F5ZoBSDaGVIqgJKeakcaeIPXtPjW9efog2URXyIimWLoSs+LyOQ5IRjWEPxsvucGyFx+nfJeVqviCTvBsa6E0au5ECIOJONw15u7Q2BMkXSPId1KWOaDsRXxdAcqOrTTZZP+eefn0b8F326mmjkOoXzOUAXxdAZJcHFKyDiMomxPLp8xks7VnWwulHZBtD73RRo+91U75iqQfhCaYD4ZmMsIXzxxjN8/HoMQ1WClzmZXZZtUKvf25OuzyXRuL1gpCJTFvCGKiOZBl7uHvDpDTI8FZJ0KJm0uZrYc7SFUIg5eTRTnD8OkkV3nRYrZIyrTQ/tPsyivvMyWuQbBzhkrbxp4gtR7uIJebYWyUcOWV91mh3sRUFmjqbaVERMG11z68Zwzs6wqQGs+t/jLDrGqhhJplDqRkvSBimnpbKRZO5jZJxeJv9d7NtHrvZrrX5FMJWTb2BKl5z6YZWccUAtwLRUT6ZXzz6snvRx42QcKcyMFWzefokoYvUr9zAy1Z44IoASNhDV89f5yV2tiobmjGnjrZSR63hImkiuiYjqEbOr545ljZ+5j649oDbbSqeUqLHwylCkpOhWK1Uvv9B5307C9XQOS/I+SPh4bw3/MjuP5pzJRAYygNZqc+OTolQj7381WYXKFh0VmerlxUZ5Sy9Ts3UCH9rxJbe6CNVAX426f/Q0oFaj0cWv0+PFBdjYv+MUxEq6AbbMYq6gWC77bT1jU+POypw6SmYd+Xl3H1gopYOAlO4qCMpzA5mrL07fu6AuRcIEJXdGR2oY+91U7zPQyqAihJwtiwhtGriRkxXqp+KeuQj73VTouXcHA4OIyOaAhf16DENch3VCQiqmWdWiEdMB+71zY64HQxjA2X5idLusF0makr+nRo6Kpu+eXTDiiFqMaeIC3+hRMAMPCZcT6Y8dCDr28hXSOMXZuEEtOgKWQ5kc2mNfW2Uq1PxNDXZaTqpt5WWr13M1WipJptfGajmFq9d3PR9jp7vWkpi+NZQdg079lEnMgQCychRzWodz9JZaOjVKzOhaWzkNFswErFWFNvKzlrBYzfVJCIKCUXzkTBbBRCVnGGIRL0dwdIsJuXoTKdwIlc2YgoV/ktR6rPu4jVo21mGxkrP6mXVQlaHcvpt+ndvo4ctQI4kRVsr5fv2kipSW3Ww4Wbq8tnry3YOXhXOVGsxc6eAMnH7pWi1NIpsQdf30Kr926m+p0bSh6qb/cppiQIvkYBaw/MnB30dQUocVvN4R33/fac8bjhQ2dYJenXMgf4uwOkxDXkVVoK2JfP/YcJAoO/gZ8eefNuX0dqXMv7PW/8xtRX4Hy6YykkNPYEqX7nhhxeE6xyQLkfKzSNUOXiIFXxJUOvb/cplo9Ihw+dYd7t68jXFSDBxmCfL8JZJ4IJDKIEVLkYeIFhqF+FEotbj4BKZCqbnUFRCEZb6MzvkNlOUOMaOJGhtt4G/88ELF3O4/6lPOZ7OOja1IxidloVrLh8uQ3QE//uoN/4PTh7I2J65C20/zRr7AmSfb44LX6m0cP1BEmO2SHYGDQN0JI6YuHkjFbacAtaKq7y1epGEfFm35/pg9sv0ZMnOsvuQZp6W6mpt5XKFWCLpsH6nRvyNhbBd9tp/aF24iRuBlmlJ0iNIOKPZ39HD3vqIGsaxkb0GfWAGVa/9PIJJt9RYa/my0qJRUOAExm8K51YcaSDqms4PFDjhlsScSU6jguX5BmDimkd0Ej933q4g/7Q0AAAeLu/H5GBygYeExEVTo84rfpalgavvfYhG7+lQhAYAovvwyMLFiAUi+PyFRk3z8emmb+xJ0iSy1jNv/ZAG9mdDG/39+PVsxdx6XOl7CmRTGJMyTqkKvMoEIxATNm1kW4PDYLngYnRXMmpeqkD0euTJdvUmmUOcDww8HUKiREV8h01b80g3r2I2WpUcPDgJQZLHQAA37x6kn1ThIRqahmSUbEgmfISQ1pp0jVCarK4dCa5psbwhk0iITU5pWJZ7oBi5logwOXmMFJgbrDcniJd9pqRtuSoBl3VreMAI2Z33J3OtFnXVny77yOWknXULrUZrkVSSUJyTDUtwlR8av1ux8qbJ+AcfS6TwC689B7TNeQ0SvlMjWtlXd4SB4yPaIhN6DOGl41adsOTncbOPX2MJUZTRecCFu1YT5F3zrJy5beKOWD0agKAEylZr1iKss8X82YhI73BPWuHQ/tPs+ELMcTCyYpj3+WV0NTbOqcDTZYwV/jgxyx+SynJwKXq9fQozI/a0sLFj9oJvq4Azebc4E+WYf8H+GZdds3IiskAAAAASUVORK5CYII=", "solar": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAKXElEQVR42u1ae2xUVR7+zn3Os53pY9phqF1KS0WsgIBtgT6koIGq/UOTdXc12WxWDYqgppCsIWkgxt24bBR2lWjMZrOrKyqYmKDGR7EtBVsWFkpBrPLogz7oazrtPO7c19k/KqXDzLSFvmAz339zzz333N93zvnO7/fdAWKIIYYYYoghhhhimHlsKcqnW4ry6Wy+AzObgy+eZ8TiecZx73tu1Qp6WxGwfX3BhF5YFAjMxrFfobxkFWVZ9vZaAdkuAbseKxqXhPY+FS3dStT21x4tonelibffFshZ4sDa4jnjkuCTdPgkPWJbRWkBzXYJ6Pdq2FNTR24rAgZ7vLC7UnHforixtwBHwJDIseUuMMJq4dHlVm+/FVB3ZhC9zR0wxRvxallh1FVgNjIwG8IJ2PvE/dSVlQRN0bCr8giZTgK46XjotgPVZDdfTFfk2JGewke9Ly2Jh6KF87NovgWmOCP6vVrUvpsL8yjVKWRFxtv1J8mMr4Cta1ePub+37KsiXZ1epM+14LVHI2uBw2GCy2kOu25LjYMqRxfIf/2+hD6cG4/0VAMYwszOFliSIaLhrV/Tr7c+GJWI850yjFYD8u+Jj9guGHmwPBsWnGDk0dvmxrYD1WEze+gPG2huUTriHVb4JIq9dSfIrBDwm3cqCQAsWHkXDu94hFaUhp/92w5UE/9gAKnzk/HJpnVh7b0dg3B3e0NXRTyHwR4v6hs9YWN+smkddWYlw+8J4ERDHyoO1pBZFcHFz/6bXDnfhniHFffON+CF4pVhQf5wwQtN1XBHhj2s/5nWIE5dlEZ+v1C8kvqCOhoa+1G+P3T2dz9eTB0OEzrP9+Crbzuw8b1vp0QcJ30K3Ld1Pzle3wlNB5Zlhqv+U/88RHpa+mG2GbH3ifvp9XlAUL12Kd7M4sqAijMtgZAxdjxUSLOcAloue/F5vSfi1pjVY/B3/zhEjp7zI87EYO1qBz5/8YGQQP97bhB+j4RMp4DnV+fS0XmA2cCMzL7VyKDLrWJ39XdkdEKUOYdHS4+CY03+KT8WpywP2FV5hJy6GIQcUJCxeA5qd5bRq+q/ZV8V6e8YgGgSIIqhJ6/ID8eTPVfEXWliSGJUXrKKpto5tPepONcaCCHmlswDKg7WkIqDwKGXN1BnZjIeSDAh27WOlu35mgBA0C/Darym+l1uGYJ3+Hd6Mo84uxEOm4KrJbJBYNB0OQg5KOOt745HDP79p0vonQuTEJdsgad7CPs+a4ffH4x6//WYtizrk03r6IJ7UiEYeQz2eOH3BHC+xYfTzRLeqDoaNu6rZYU0PYVH76CGHo8GSdYRkGS8eeQ/JFKFmJbMI2eeCWmLnEicfzfUYAA/1tTj48ruG1opE76xdmcZzS7Ox1BXK36qv4C6pgC8ko6grEYtVv7+2zX0zqx4cAKLpiY3nny3ctzxNhfmUYYZ3pmjidpcmEftVh4JVhYJFhYCT5BgYWG0GoYry04ffrn3mxue0BvqULuzjAJAd7cfbb0KlJ8VXKfDiu4PUiiqPvLi29cXUJt5OJiWLgl/ra2f0HjP5i+nZrMBJpFA04E4E4MkKwtRIPBLFB39KtxeFbquT7pSvOnOz61aQVmWhShwSLENz4ooENjN7M/7W0VbrwqvpEOSlAkHP9pUyXYJAACvpMM9pKHfq0FWprY8vmkRvH5vbinKpzYLh1Q7h/RkHql2DkGVQumj8Pm0Gy+pfQraegiCKsWAV52WE2BaRXD7+gLKswQ6pegdkCKK2a0Abroe/MoXh8n29QXUlcjB4+NvuP/GvGU00W6CzcwgxcaBYQB9lHnklXR0uVX0e+RJlcRTRsDWtaupSRzO7JKsLMxGBsl2AYKBh3vIfdPPTbFxSHeZwLAMKB0WXUIIdE1HQncA37cC7iEykmHeqNbcFGvP5i+nJpOI+U4BKTYOViMD0TQsWAGvfC3N/DnPPHlRmlT+vuOhQsqzgKIhxEDxBjRoqgZN00CY4cdTnULVNLxz7OT0JEKbC/NonJlHejKP+S4DDBYRki8IKaCivU8dOaIopSCEwBHPwS9T9Ln9E67dn8ldSgVeAMuxYfnArGnAM7lLKcdxoDrFoE9Bk6yjo1+FToew47PDJJoQKhoQVCgYlpnw6iIMQUK8gEynAIEnmJNYRKeyApyRU+DDjWtpsk1Ac6eEc5dlKKoORVHGPA02F+bRxDgBZgOBrFDYrSwynQKMVgN8HgmNLVKYT3DLEfDhxrV04T0piE91oLe5A5W1XWAIMODTwTKAe0jBnpo68kzuUgoAb9efJM+vzqXxVgE5vxAxL8OGoF9GfaMH5furSUVpAc10CnAli+AEFm63hLMtQbz8aQ255QioqXiYLixZBcFsRduJOhyuuYyN731LXiheSecm8UiwsLh4RcGQ/5rXTwiB3cIhLWk4iUqaEwdrohmtZ7vw4F++JKMLoPlOAdl3GMGLHJrbfGi4JE3aH5gSAipKC2jJchuyVt8L0WJD64ljWLLpAzJaxVcuNKKtR0G/V0OXW4XDxsEn6fD4NNgtHGwWBllOAd+3BbFqWSKMVhHfVHWELfkdDxXSJRkiEhKNkLxBnO+UJ2WPTdoQef/pElpanAJbahw6zvyAuo++CAn+qoPM8izaelWU768mViOLdAcPkSOYm8TD7VVhNTCo/zGA8v3V5PDxPvS3e5CRKuD6z+cVB2tI2Z6vSX2jB4pKcXeWFZ9uXkdnhYDanWV0RUE6DBYR505fwbIXPyQbXv+KXF/n2+0GtHcHR1zctCQOLqcZHEdGZjjVPrwFrrrJh04NISDrWJ5livi1uXx/Ndnw+lekvtGDQb+OitICelVXZoSAU3/7FU3LycBgjxdHjnRErMW3FOXT9BQend0BNFy65v5mppthSTBBHWWIWm0GZDqFkFS6s19FzhIHHlmTEvU9yvdXkyffrSQ9/QGwDDszK2DXY0VUDii4cKwJy1/6iETbg64kAboONDYHQ8QqwWWDKd44ouRvVB0lnMDBMS8xLDhV1pC95n6ceefJMWf3re+Ok4naYJMm4HKvgo+/7MKaP34edcAtRfnUamRwvlPGK1+EJkqOBQshWkK/FimSAsHAY/fjxSGBLn/pIzLU1YaUOxeFuc2z5gq/UXWU/PmbWjJWJSfwLNr7VPQOSGFeoWiNh+wbDLl+9oIXfZcHIj5vbumfSPvpBhgMHDYX5tFZJ2Dc/JrjoKg6+gcCYZmfolH0XTiLKxd7Q/pc6JQRGJIgcJF5XbLpA3L8Rx8A4On7ltJbloCNecsoy7HQVC2iNd3SraD5VDPqTg+EfVcwWETkLIhDtH+ObTtQTTRNAyG38ArgBR6UDn+3jwSRJ+hxy2jtDoa3mQQ45iXClSSMacVRegsTQHUKORjdocnJMCHBwkY0Nr1uPwDAaR+7SJ1orT8rlth49lTiXBuGen0R2xov+mGxD86oJzjlK2A8b85oNYxYW2FH574qcqKhD53T/MeoGTFFo6H7Uh9+uuSN2n5mjLb/C5SXrBpXwp5asYQihhhiiCGGGGKIIYYYphX/AykHdfKoNTWkAAAAAElFTkSuQmCC", "claw": "data:image/png;base64,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", "storm": "data:image/png;base64,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", "execute": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAFK0lEQVR42u2aX0xbdRTHvxf6h/YWygpe/rRgB7IxpCb8mRY3jHNR4xZjEzIXiVFnYk00JiQ88bIHX3xy7IUX9zQ1JMtiwh4kLpNo3CYgf+oGAhuulq6saYFCaS/YrvT4xIJL6L0XWtqS+3n+3fs7v/M759zvOS0gIyMjIyMjIyMjIyOTRg7hEqVj35xMcQCLwrTsq8iEw7digB4jImk9AIQRgANnmKx2gE0zSI0mA27MegTX2jkHnagpQTgSAwB8Ozqb/RFwzloFfyiCmziZ8CZ7Glz0/nETNDUh/H1LjZ+mvZASNRlZAzorJsmo18K5GBa8+VN1ZchvCmDZUYDbzkVcn/ZiCKeYrI4AU6EW4UgMX7nqEh7kHYsJAPDbFSV6x+7iG38DkywbkuIAO+cgrVKBi/MWSYbNBXjMBfiEay5YHpAqNwff/eHC+dnDTLIvYdcpYEU/PV2dxTI270/otJ4GF7WYi3F/IZSSw6eEOlwW7YRmXNt27UeGMeq2OKmzYpKwX9nOWa0YIDvn2F8H35oqYoVOpspnybTrR+iC5QG1scOUzBTKOCls5xx0pEQPnVqBGd8qvn5YzwAAp8vD64dLcZgrQMXMBCUqfFP4cE+LXdKEUDP6CACqilm821KO87ZaXGp2EwBcnLcwP9/z4WARC/uxamRSfqfE2x3GCTr9fDl0agXGPcv43GFmNj9rjaYDuDLuFtQM7foRWovGMLfuAY8V3Mcn2fEZfFrqdlZM0tYCaNMMCt6+Ff3Urh8hMWvTEgF1uEwVimo0mgyoKtYBAJyLYUFJm+pP6kFVDZS5DPrWW5g9SYEu8xRVFetQX6ZHYC2KWDyOO54V6PIUcAfWJEvjZNBtcdJcgMfQ/EOsYkGwqCbNQDvnIJNei6ZKA5orDcjTEb6/5cGNGS886z6sIZiyCr8ZkW8eKUNZgQbv3S5n0l4EnzWwmAvwexoFds5B+WolvKvrcAYXRLXLkoyzop9KNQegVSmwxEfgj3lFj6TsnIPmAjyux44zYm9VDe2ORl5blaTQ2IwRY3iRVo3oRvxJD08gjLoD6A0eFXy+jR2mD140Q6tU4Oqfbkm9vBX9VKQqxGp0XXBitN3zEfA7d0CHcYK63qiDzhjF9GQM/X89wp1HK5jnl0SFVysG6LNjR1DMqjH4z+L/WtrTqt/px+jLgu9o149QLVeA/DwlRtxLopyeVCmcpyMwijh8oX9x59EKfuBfEm3AY0Qw7FrC7EIIWw+7KYhqxhPLYgDoDR5l2mLD9NqhErxdb8RZlY9+ue/fu9rSZZ4S3ciIaWzsnIN85zYo+EWMOowTJLW4/vrWMo3aQjRqC2Vny9zGDtO1Ez76subejo3vaXDRyqdxunbCR1KnUBlBMozuME5Qu35k/06Lsnbqs9kW75asmfZszW0xISllNNaAqyl3Qk6ycrqIVeFhcFVw7VlLLaRMeqU4LC0OsKKfmowclviooFrrtjjp41crUVtSIOrdDpxhlFAjlZV+1w4o1RyAQavCPL8kqCes5iJoakJPft0VK6Y4VpeySEhKCniCawmlsU0zSMern0GdmQUAqBTitx3CKcbPhzM3BTzrPsEG55XnOJTk58HtjWAjLH0QfRMnmVUspMQBux6Lj8ImONysLtZBrchBZZkaUS/gWV6TvE+qhikp/39ALVeAF8oLkZvDIFezgSkXn9bZYdIjQIhxTwBleg3MBhb+iRz03fUgk9iTm2jFAHGsDhvxuKSJrYyMjIyMjIyMjIyMTKr4D/LuL5nDuq63AAAAAElFTkSuQmCC", "heal": "data:image/png;base64,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", "shield": "data:image/png;base64,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", "evade": "data:image/png;base64,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"};

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
  const SZ = 82, N = def.frames || 1;
  return <div style={{ position: "absolute", left: sp.x, top: sp.y, width: SZ, height: SZ, marginLeft: -SZ / 2, marginTop: -SZ / 2, zIndex: 12, pointerEvents: "none",
    backgroundImage: `url(${def.uri})`, backgroundRepeat: "no-repeat", backgroundSize: `${N * 100}% 100%`, imageRendering: "pixelated",
    filter: "drop-shadow(0 0 2px rgba(20,18,12,.85)) drop-shadow(0 0 1px rgba(20,18,12,.85))",
    animation: `sfxframes .56s steps(${N}) forwards, sfxenv .58s ease-out forwards` }} />;
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
    const t = setTimeout(() => setSprites((p) => p.filter((s) => !ids.has(s.id))), 660);
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
