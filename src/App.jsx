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
    else if (T === "heal_team") { const amt = Math.round(140 + u.magic * 1.3); friends(u).forEach((a) => { a.hp = Math.min(a.maxHp, a.hp + amt); sfx(a); fx.push({ k: "healnum", tc: { col: a.col, row: a.row }, amount: amt }); }); }
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
    @keyframes dmgfloat { 0%{transform:translate(-50%,2px);opacity:0} 15%{opacity:1} 100%{transform:translate(-50%,-26px);opacity:0} }
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
const FX_SPRITES = {"nuke": {"uri": "data:image/png;base64,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", "frames": 22, "spin": false}, "venom": {"uri": "data:image/png;base64,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", "frames": 21, "spin": true}, "solar": {"uri": "data:image/png;base64,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", "frames": 16, "spin": false}, "claw": {"uri": "data:image/png;base64,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", "frames": 20, "spin": true}, "storm": {"uri": "data:image/png;base64,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", "frames": 16, "spin": true}, "execute": {"uri": "data:image/png;base64,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", "frames": 15, "spin": false}, "heal": {"uri": "data:image/png;base64,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", "frames": 15, "spin": false}, "shield": {"uri": "data:image/png;base64,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", "frames": 18, "spin": false}, "evade": {"uri": "data:image/png;base64,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", "frames": 19, "spin": true}};
const FX_KEY = {"nuke": "data:image/png;base64,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", "venom": "data:image/png;base64,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", "solar": "data:image/png;base64,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", "claw": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAHVElEQVR42u1bS0xbZxb+/nuvzbWBIfW1A4RHKpBGEWqVKE6ILBIwE4MNbqtJJZTOglZdFHXXRTeJukAZaUQ2s8hmFGUWozSLzIjFjCYhJIU2kNKipECppqJRJZgpA0NSsAMF29e+jzML6kwyPOLrJ8Q5OwT/f+/5zus75x6AF/JC8lrYbn3xFqmR9pAFALDKZNwMDCeli7AblW+UXGSFGXU8wwFBQ4zMKJA8tIIIhgJfsLzwgLh02vx0WoxiRDFhWtMxxy1jdOkuy7tY7rT5aaDiJL1payEj57jnBYAfWBD175ehyWTM+M8NAL2evbC6SlAnaPkJALdHABMYREb5CUBkbBXR+2FMKMYK26YB47Ifo3L9F2gyMdQJGkRGmFAEfPDwk5xkV5f9GD0rs18obaVaXsdr/xk09I4b4HJLDeTQi9BlUVH/fhmsrhIwgeHw/TBqf+uhyzKPMIuhL3A7K2B02LzUu3Trmc8aU0wYUdTUiVAJLIgxDV/GTKj94zzkb9fA7REQGVvFtMZBhACRBHTYvBRmMYQQM0w+EpWBipM0pgC9Cf59mMVSe6BPaqLLZS10fZ/HUCaptx+ldCs/U+2mmWo3GfGUpJLnkz8UkwgzA/4iFxi65N7SV2n1gM8rf0WFrhLUzA4lfG+y1t9QBe6rPK4E+3JGJTttfpIY4cZw2NC5EJID4KkcsMwimNTNOStlPqmJKjgdPSGrISPU24/S0FJyeegpDxgI3GGPEMoZAIc4KwAY9sBUQnBDCNwJjObE/c842ui4ScG0pmeXQe4EFtft8FGXJYJVYugN3mJ5BUCHzUunxChkYrgRzX7+MQSAy34s7fX+uGn9yo9lMafVx5DFevYmRjpetR8kp91JWxGlboePZqrddLls6yHGq/aDtKNCoDd4ix0xqUiEpf1j6Rs2vjTORBLgl5rJLzXT/7s+AAzGtnZ9c4bHlkm73Ey1mwpdJbgxHMa7DwZYot5Ty3OY1nTU8QynxCj+Khfg3OLNTc83Si6SmZp2ppmWJFgzO8S+/2IVx0wqOm1+StR75jUOq0yGjdPRHzVvqTwAFEPMqPIpV4ETc5+xnpAVFbyOM442SqQhuRLsY4c4K/YwwoQKzDpb6Wr5xhyQbHOT9TJ4JdjHJvV13v6OqOFqeQtt5xFdUju9JcqY0Xj0Bm8xzsrhje5KzHvaqUtqp3g/UMtzWZk5pPUBZxxt1GWJQCaGj2UR5xf7N9w/72knrohH+d+uPf7dVFUzveQswsPxNfxZFjGph1FMYlZIUdof0O3wPc7u3ygCBmPmx/X9ankLvdFdiR9+9y/U/XujdbsdPqrhNSwTQ1DnMKVRxkHIyOUdNi8dNxFeL1hvUS9HRJxbvMlmna3EWTlUfr514uuweemwALT9fHa7KrFjAdjMG34fsuK0GN12aDl3wkd6WEf1+Ces2+GjdywyAOBa1IwRJTN9QsZjrMPmpTqeYUHnECGGGl7b1KJTVc20/6OX8fdzc/jNwjqv6LT5yWOO4aBJzZg3ZG2yW8Z4FHKEt0QZpc4iPBpfeyoPLPz6ddLXNFQM3mCbJde3RRkiI1yKWDZNrju6G6zlOSwTw/nFfvaHsAX6mob9H72MuRM+iofKw/E1nPt68/PnF/tZT8iKu4oJx00KzjjayCc10a7wAL/UTFYyb4jfq+Ut1LCP4cN/Mrxm1vGdJiRk2TidBoB5jUu5g8wKANsRmp69XrIyQr8ahYOKElao0+ans4VhBIjhxNxnbEeGQL39KK1C3rZKtBXEENQ5FJOICl5PmAJfCfaxu4qAXzYUw8j3g6yK0+6k7Sw4U+2myarmp3qIeNvcKLkSVmqm2k0DFSdpx3lADFt/q/OY/0d0nswPfYHbrC9wm8lMhdPupEQGIjWzQ2xMEbLWQKWlZ5isaqYLpa1pf2GjY7usD0U7bX56W1zPCyNK+nOw0QWprAPQXhCDyGiD6+dKsron2GHzUjHT0s7mdjwTfJIRjiimnCm/WWVJGgCjOwHxKVF8epQLeQmFaJEaKWUA3FIDGRlW/qmshc4WhjGvcUnv9KZDDnEC4vvFKQFQCGOfsNqbrAgQy/newYFNdgiTAsBKiQMwU+2m0OhKSnw9HSF4WowiRuub5SlVAb/UTCIldqxnr5emNRUt85+m3fL3lr5ibqmBCmGGlcwQf1bliEnBqUrAcqQY+rKKjsEfsZ9sGFF0fKcrG0JQyKT1J1Tg7I+fZsztn9xOi7fdtbwO6b0qFBywglTCtVeKcO/iA1yKCFhhkdTb4ev7PDStcc9cmkxkuTFTcqG0lQ6bVMjEMKXyGFYIC9xPqa/RXyhtpdDFd2nW2bo7mo50E6HDJhUFB6ywHClGXgIgEwOpBH1ZzU8AplQe4dEVhEZXnhsADFWBYYVQd/EBvoyJ+ekBC9xPuBQRMKGruL7PQ4nuBexkMVwW3FIDlcCCN00MZra+Wjupq3iEUM52DLMKQFx8UhMV03ooLLMIBgJ38u9f1V7IC9n98l9m7jDOAg3HTQAAAABJRU5ErkJggg==", "storm": "data:image/png;base64,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", "execute": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAK/klEQVR42u2a228caVrGf3Xurj63291eJz4lkzjM7mbD4AzZkN1kxe6MtIwGhJAG8Q/MBRISd3PBJfdISFys2Lu9YS5BywWREIkIHuQdJiGH2c3BccYdu93udld3V3edqz4uOjaDYIZgx51E+JHqrr6qep/63sPzvh8c4QhHOMIRjnCE/6+QDvsF76c+EaauIATkUxppTcGPErpugBvGAKQ1hYWJDG9UcuiqzLrlcGezy8f224f+fephPfiD3Iq4MF/hrZkSSSJYbQ/oeSGyJDEMIkxdYeBHeFHMsUKaiwuTnD1WxFBk3DDm7nSRhbV74rO6xdX4kvTaEPBh9Zb4rRMV3jpeZm5eRcmGRJZO0dT55VaPxztD6paDE0YAmJpKLZemkNZIEoGbxGQNlQvzExTSGgDBk+viGpelV56AP198IH7v28dZWJTQKj6y6ZI4CiKUWaia9L2QxztDEiFIqcreumEQsdX36LkhtVyKyqSMpAnyPY1aLs1itUC2tyx+7l+UXlkCfrq0Lr67UGG6lAJ8AGJbJQlkJC1ByUZUMgYnJjKUTJ0gSmjaLp9v9dnoOWzbHou1PIW0hloKkPQE7YlCzlA5UclQy6WQNz4Rf+d9V3rlCLj5+wNx6pSKs63xpO1AGwqpNJPTEqm5IXImIurolFsZjhVNjhUhSQT/shaxa9CH0S0xUzQ5PZlDyQ6RFEE2ZZBLjdxAVyLmyxne73wiep7Pda5IrwQBH19qiG9+LyJ2BRsPI5bX2jT7HrMlkz/IH0ctBaMXlQMgQ/6ZQUGUUDL1veecny3z/cUK2oSPpAhkM2ZiCub7GRp9F12VSUSGYloniGOmdlbEi8gSBybgnTdryKZF93aOf1vf4H6zjxvGFNIarptQeHZf1NHx42RvXUZXubhQ4a94Iv745rx0Yb6CPuWSuAph20DSEiQlYTJr0LQ9DFXhZCVLIaVh6iqrbRvuHJyEAxHw+I98Ufx+i8jSWdsZ8qhtY7kBpjZ67LrlkL1VQlISQksnSUI0WWYYRKDCVC7FlTeq/FOtI0xdobemcLfRo9F3Rx8nS0SJIIgSTF1hrpxjoWqiFgIm6xXqXYf65/8glnlXGjsBH19qiLkf9gEId3Sa9hDLCQFwwojWwGN5rc1q2yBraBTSGvmURt8L2eg6RImgnh65wMAPWW0PeNS2udvo8eVo/45yQ+iqzLGCSdbQWKiaALhhjK4oVFJ58F7CDqhmDeKeTBRLrN2TWF5rsdFzsP2AEJ+6lUJXFHRVpmTqLFbzzJZMdoYBlhMQxCMDum5A0/awnOB/LHiuxpckYmAbnPBTsW17zJUztAYjq9+cypM09p8i90XAFa6LRt/Fuf8NRAL/vtH4b39ulAefXT5csa6LWi5NLZfC1BUmsyl6bkjT9mjaLs9T6PzMWpKaN2+IuXKGuXKGExMZTlayOEEMm/v7kfJ+FumKMvJNXyDJ0LR9/rc/cI3L0sf229LjncHoxZJEEMfPbfyXd8S91jbbtrfnWqaujNcFdFVGlSWcMGbbjlh7ZtTz4Of+RSmo3xC1vEvPDdlPibvMu9LsYEUkYhQgd2PP2AiQJQkniLm90eX2Zpe/3Dz7fzLianxJwjpY+hWCvWC4qyvG5gIAfpyw2h7wr0/aL03Ly5JEIa39F10xNgJyhsowiDgMgfK8bjhTMpkpmkxk9PG6QCGtMVfOvNROTiVjMF8xUfMRtVx6vARUMgbfmS0wYRovjQBDlbEGIWlfGVWW43QBQx0tq+YMPqzeEi+DgMlsiruNHn9/b5O7je54CdjouaxtOwCcqIzfFf5k+rZYmi0z8EN+sd6h0XfGS0Cz71G3HHRD4tdqhbETMFfOUMkYKLJMIgQ+YybAjyPcMEab8PneqQofzd8buxustgc86QzwohiZMafB61yRHrZsgpaBmo/47dNTY4kF76c+ER/N3xOFlEa962A5AaW0TlbZvxvuWw3e2ezyzw/bnJjIoqsy52fLOOGn4mfW0qHUBT9dWhc/PDOFocg8aNlsdB1K6SJOEPOkMxyJrnESYDkBD1s2XTdgZxgwDEZNzz+MV0RnGOyrl/+OckMEcbwnuGr5FOeOlXj3zDc48yMXJWMRbKWY+czEcgJkScJyQ/peMP4dcDW+JM01b4rWQB/JUaCaS3G8aNIaeJQ7K2Kr//xK74PcivjR4hS6KtMa+LQGHjOlDBcXKpz4lkDJ/Geur3cd1naGAPyq2ecgM4MDtcQetHrMRlmOFdLUculRzy6t0XNDZkoZ6taQqc6KGPgRsiTxdS1tXZX5jdkyC1WTp22Pz552sP2IuuVQeFBgclBCyYb01gwebm/yq2afnhccKAUemIDrXJE+iFbEZDbFdCHNTMlkKpdiy/Zww5ggSva2c8nUKTz96hjR7Hu0Bz5nlgQLEyrDIM+n9Q63N7ustgecbIzI3er3edQeud6W7Ry4PS4fNDhZzmjIGScJXSeg44z80fZC1q0hfpRQy48I+jrVdjW+JN3e7BI2U88qPYOcobIz9FnbGXB7s8vdRo+HLRvLCbGc4IXMBg7cFr8aX5LKjRUx8EMafY/jRZM4SVi3HNpDH1NTKaU1/Cjmr1u//rUf/GDbZrXuoysy7aGDKkvkDI2m7bFtewz8EMsJafTdFzYwfSGTob/pvy1d7l8ThqJSy6cwNXWvSVEyNaJEsG49n6/WLYdECPpeuBcbACw3oGknX9k8fakE7MYDYsAaNU11ReFMLc9kNrUXzN4zvrp7+2H1lpgpmcyUTOqWg+1HGIqMpkg4YUTdGnIYE+JDOR9wjcvSlfi6cMN41PyMEmq5kW+/11sWMJoM7U51do3/nW9Oc3LGIIgS6l2HLdvji86QdWvwwmaBYyFglwS9c0NMZPS9+T/A5Tcm+cGpGpmi4KP6QCyvtQmihJOVLAtVk8SHvhfyqGVzr9E71MMRh0oAwG5VNwwitm0PRZY4VjSpXraQ9YSz35E5dX+KLx4nbPZcfvHYwg1jftnscfNph8M6FDE2AmZKGc5OF3m8M0qHP9k+JznBLXF68ltUlmwiWyXq6Wz2LG5vdnHDmLSm8Lg9RFeUfdf3rwwBbx0v84NTNRS5xZ/dPy0B/GT7nGT+4x1xYbWCocr0vR62H3G8aDKVH02LWgOPtZ3xyOpDJeDcsSLFRZfzYZk/PX5H/MXTb0u7Wt4JYkxdIU4ES7NlfnxhAn3KxXkwmvrebfRe7x3wnrEsokQQdQyyhsKP35zm/OyG2BVOALYfYTkBxbSOPuWiT3m4j3LMFE1OTGT3Pe97JQgIooRG3+Wzz2VSqsJ0Ic35EyVkI6azI7CcgLrlsNoe0HUDnAcVIkun0w9xw5hiWh+LC8iH9eC5cgZDVdjqe9zf7tMe+gS+IPEVkkRQSGmcny1z5VSVYlrn9tMezTWZLzrD0b1xzGWuidd2B/zm3ASnqznqzzTBVt8jpSp4UYzlBJydLjJxbkC1EHJmK42/nsF1E2RZwnICNnou4bPTZq8dAR/kVsTueZ62plDJGFSzoyHKVt+jPfQ5NZlDmxwZmJp10CYCtHWTieHoPlNTR72++DUkYBhErLYHRInYk8dFU0dXZPwopm4NediymbtTwDjuIiKJ2FVIfIUwCZjKpRj44VhS4aFVWu8Zy2L3QKSuyixW85RMnWbf49aGRSGtsVDO7qm9jK6SM9S9zHB/uz+Ww9Jjm+wu8bciSxHBKK4NsJCQ+ZTf3fuGLwe9wxI/RzjCEY5whCMc4QhHeIb/AHtkdyx+PwM8AAAAAElFTkSuQmCC", "heal": "data:image/png;base64,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", "shield": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAEaklEQVR42u2ZzU8cZRzHv8/zzDOzLyywCw1vLaZpiaSeqrgCCyEEjX+Cdw81kg2EBP8BLx6saTSEXj168qhp0lpNWWwAY2I0UYkH0WILSGGXnZd95pnHw0pNExWmzDTT9vlcd/PM/L7P730AjUaj0Wg0Go1Go9FoNM8a5HE/cH6qpDIWhZAKnBGkOAGlBMJX2KkKfPjV1+SpFGBusqSGB9Po7c5g866N1Z8dyKD5W6GFof8UR8NX+OmOB9cVWKiskKdCgNmJETXQl8JAj4lMqwW76uH1D66RfxMol6ZIcYK0RXHgBNjea+CjW7fJEynA9OiQsiwLXe0GOnIMTiPAzCdfHvm88lhRdeVTyOcYqnWJu7sNCCFw9fY35IkQoFwqKhCAEgpCCaSUWFgK784z48OKGQwpkyBjNnPGXk1E7hEk6jg3GIHjNiB9GcmtzYwPq+6CiXO9Jqr1AN//6kSaKI2oDnp7+CUFAI7TiDSBHd74/FRJ9XVwUEoj9djITmMGg/RlbNn78o0K+WXThvRl8gSYHh1SXfkUTJPFW1JUU+hDb0uMAAYz0JaliJtABWC0KULiQuDACXD5RiXWmr24vEZcTwAqYSHQnuNoSYc76lLxorpUvBjaFCF8BCpIlgDnuk0UciyU8YbBkM1m8M6rY2pmfPjYQjBG0ZZLoTxWVIkQoFwqqpobYGNLhM4buTTFmU4DvZ0WjiuCZVkYfj6Nwf5scvqAO38KvHdt6djxT0jzr+9+doscNlCmyTA3WVLSl0d2e7ksx2CKJSMEmMHAWbjcZ5kmLOsf7a/crBBCCM52cbTnOKZHh/7TG67crJDf7nmouzIZHtDVHj4B9nZa6MkbD7XQ+WxzAqw5ARaX1/5X0Y1tgfYWKxkCtGYZgiBcPurJG7hwoYBPy6+p1XUHALBdlQ9u+Eivo80wSIQA1bqEK8IJIAOFdGsKhbwFwIHbUMcy/BBXKNRtPxk54H49fE1+8+MvyA/f/oHv1g9CGw8AezWB5R/tZHhAQ0h05EzMToyoMGPqG1evP3LX6Esfe/siGR4ghIDtBehs5QjT0JxkP2AwI7IN0YkFWFxeIzt7DoRUON+XwvxUKTYRZidGVDZjIAgS1govLq+R3X0PtqfQlolnJC6XioobFLV6tAuXyKbBhcoK+X3LQdUJYgkFSilcTzzSfvGxCHAoQkNItOd4ZMMK0NwUByqI3PjIBQAA6UtwRlBotSIRYW6ypDjnsRgfiwALlRVy774LzghOn0qfKBxmJ0ZUoYVFvgd8aDCLs1yd7Uk9+MLDDIZcmoIzAva37GmLwhMK+7ZE7aABKWVzuOIcKbP5anXbj/XrUKwrrPJYUR0a80K/hedOZ8EMhoYr4NkCVoaDWwZ2t22srjdL6csDafSeaYW95+Dz1Srev74U6zsacR6+sLRC3nrlRSWEgY0tCm7Y4Ixgc9fH/ZpES9pDoYVh90Biv+6DUgrbCyBcgc0dL3bjNRqNRqPRaDQajUaj0WieSf4CIS7SB2hgUX8AAAAASUVORK5CYII=", "evade": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACCUlEQVR42u2Zv8rqMBjGH/9gFVqcKoqbOIhegIqLWATpJoKbXdykkzdQOrh4Ab0AB3F0cnMWBHF0s5sWCoKDk0q+9Rw4h/PxnVaieX9jkzR5nzx5kxCAIAiCIAiC4It+v8+63S4Lu584j8GbpskKhQIOhwOEFKDZbEJVVRyPx9D7ivIWvOM4rFarQZZlJJNJ8RxQrVahqiokSUImkxHLAcvlklUqFcTjcSiKgnw+L44DFosFazQaOJ/PuFwuAABJkvjfroLYqqbTKXNdl202m9/+Zds2G41GjOslIMsyTNP8r0GWy2W4rot6vR759btlWZF0Oo3BYMC4FeD5fOLxePy4/WQyYdfrFa1WK/Kn8kQigWKxyK8D5vN55HQ6/bi9oijY7/d/Lfd9H9lsFuPxmOETGQ6H/wzMtm1mWdZnCvBdwsoDgZ4DNE0LbZY8z+N/ljRNY+12+62sGqgD1ut1hC7yIdHpdPjPAaFaNRqF0ALc73f+B/luCTAUB7yjCIELEIYIQgsblqhvJQAdBAiCIAiCrsBBE+c1eF3XxT78CC8AQRBi86okGBU5+LedfcMwmGEYTGjrByUCV0vAsiyWy+W+VXc2m33WM5zjOGy32zHHcV5qbS4c0Ov1WCwWAwCUSiXYts1elQy5uAzdbjdst1t4nodUKgXf96HrOlutVvTaTBAEQRAEERZfSLWx4qH1474AAAAASUVORK5CYII="};

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
          <div style={{ position: "absolute", top: -10, left: TOK * 0.04, width: TOK * 0.92, height: 4.5, background: "#2a2316", border: `1px solid ${C.ink}`, display: "flex", overflow: "hidden" }}>
            <div style={{ width: pctHp + "%", background: meta.side === "A" ? C.mend : C.blood, transition: "width .12s linear" }} />
            <div style={{ width: pctSh + "%", background: C.ochre }} />
          </div>
          <div style={{ position: "absolute", top: -4.5, left: TOK * 0.14, width: TOK * 0.72, height: 2.5, background: "#2a2316", border: `1px solid ${C.ink}`, overflow: "hidden" }}>
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
        if (e.k === "hit") {
          const fs = 11 + Math.min(10, e.amount / 26);
          const dx = (((e.t ? e.t.charCodeAt(e.t.length - 1) : i) % 3) - 1) * 7;
          return (
            <React.Fragment key={i}>
              <div style={{ position: "absolute", left: cx(e.tc.col, e.tc.row), top: cy(e.tc.row), width: TOK * 0.62, height: TOK * 0.62, transform: "translate(-50%,-50%)", borderRadius: "50%", border: `2px solid ${e.magic ? C.lapis : C.blood}`, zIndex: 8, animation: "ringpop .2s ease-out", pointerEvents: "none", opacity: 0.75 }} />
              <div style={{ position: "absolute", left: cx(e.tc.col, e.tc.row) + dx, top: cy(e.tc.row) - 12, transform: "translateX(-50%)", fontFamily: MONO, fontWeight: 700, fontSize: fs, color: e.magic ? "#2f86b3" : "#c23a22", zIndex: 11, animation: "dmgfloat .62s ease-out forwards", textShadow: "0 0 3px #fff, 0 0 3px #fff, 0 1px 1px rgba(0,0,0,.45)", whiteSpace: "nowrap" }}>{e.amount}</div>
            </React.Fragment>
          );
        }
        if (e.k === "healnum") return <div key={i} style={{ position: "absolute", left: cx(e.tc.col, e.tc.row), top: cy(e.tc.row) - 12, transform: "translateX(-50%)", fontFamily: MONO, fontWeight: 700, fontSize: 12, color: "#2f8f5b", zIndex: 11, animation: "dmgfloat .62s ease-out forwards", textShadow: "0 0 3px #fff, 0 0 3px #fff", whiteSpace: "nowrap" }}>+{e.amount}</div>;
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
  const dur = Math.min(0.72, Math.max(0.45, N * 0.03)).toFixed(2);
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
