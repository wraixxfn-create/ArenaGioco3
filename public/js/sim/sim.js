// The tick engine: one tick = one in-game hour.
// Orchestrates travel, NPC traffic, economy, politics, weather, scans, contracts.
// Pure over the state object; DOM-free; Node-testable.

import { bus } from '../core/bus.js';
import { clamp, hashStr, mulberry32, rngInt, rngPick, rngChance, uid } from '../core/util.js';
import { dayOf, hourOf } from '../core/util.js';
import { GOODS } from '../data/goods.js';
import { FACTION_MAP, relKey } from '../data/factions.js';
import { ARTIFACTS } from '../data/lore.js';
import { mooringById } from '../world/gen.js';
import {
  UPGRADES, capacityOf, tankCapOf, maxHullOf, speedMultOf, scannerOf, cargoCount,
  priceOf, spreadFor, buyPrice, sellPrice, isStormed, warOnEdge, legHours, fuelCostOf,
  findRoute, netWorth, knownMarkets, bestArbitrage, hasTrait, shareDividend,
} from './economy.js';
import { refreshOffers, tickContracts } from './contracts.js';
import { maybeEncounter } from './encounters.js';
import { addLog } from './log.js';

export const TICK_MS = 800;
export {
  UPGRADES, capacityOf, tankCapOf, maxHullOf, speedMultOf, scannerOf, cargoCount,
  priceOf, spreadFor, buyPrice, sellPrice, isStormed, warOnEdge, legHours, fuelCostOf,
  findRoute, netWorth, knownMarkets, bestArbitrage, addLog,
};

function tickRng(state) {
  return mulberry32((hashStr(state.meta.seed) ^ Math.imul(state.t + 1, 2654435761)) >>> 0);
}

// --- Travel ---------------------------------------------------------------

export function depart(state, fromId, edge) {
  const p = state.player;
  const to = edge.a === fromId ? edge.b : edge.a;
  const fuel = fuelCostOf(edge, p.ship.engine);
  if (p.fuel < fuel) return { ok: false, reason: 'Not enough embers for this leg.' };
  p.fuel = Math.round((p.fuel - fuel) * 10) / 10;
  const navBonus = hasTrait(state, 'navigator') ? 1.12 : 1;
  const dur = Math.max(2, Math.round(legHours(state, edge) / (speedMultOf(state) * navBonus)));
  p.phase = 'travel';
  p.travel = { from: fromId, to, edgeId: edge.id, t: 0, dur, encounterAt: Math.max(1, Math.floor(dur / 2)), hadEncounter: false };
  return { ok: true };
}

function arriveAt(state, mooringId) {
  const p = state.player;
  p.mooring = mooringId;
  p.phase = 'dock';
  p.travel = null;
  const m = mooringById(state, mooringId);
  if (!m.visited) {
    m.visited = true;
    p.stats.visited.push(mooringId);
    p.credits += 25; // cartographer's bounty for charting the Reach
    addLog(state, 'travel', `🗺️ Charted ${m.name}. The cartographers' guild pays a 25 g bounty.`);
    bus.emit('charted', { mooringId });
  }
  p.stats.docks++;
  bus.emit('dock', { mooringId });
}

function stepTravel(state) {
  const p = state.player;
  const tr = p.travel;
  if (!tr) return;
  tr.t++;
  const edge = state.edges.find((e) => e.id === tr.edgeId);
  if (!tr.hadEncounter && tr.t === tr.encounterAt) {
    tr.hadEncounter = true;
    const enc = maybeEncounter(state, edge);
    if (enc) {
      state.pendingEncounter = enc;
      state.paused = true;
      bus.emit('paused');
      return;
    }
  }
  if (tr.t >= tr.dur) {
    if (edge && isStormed(state, edge)) p.stats.storms++;
    p.stats.legs++;
    const route = tr.route;
    arriveAt(state, tr.to);
    if (route && route.length) {
      const next = route.shift();
      const nextEdge = state.edges.find((e) => e.id === next.edgeId);
      if (nextEdge) {
        const res = depart(state, next.from, nextEdge);
        if (!res.ok) p.travel = null;
      }
    }
  }
}

// --- Economy ---------------------------------------------------------------

function prodFactor(m, state) {
  let f = 1;
  if (m.riotUntil && m.riotUntil > state.t) f *= 0.4;
  if ((m.stock.grain !== undefined && m.stock.grain <= 0) || (m.stock.water !== undefined && m.stock.water <= 0)) f *= 0.6;
  if (m.stability < 35) f *= 0.85;
  return f;
}

function economyStep(state) {
  for (const m of state.moorings) {
    const pf = prodFactor(m, state);
    for (const g of Object.keys(m.target)) {
      const boom = m.boom && m.boom.g === g && m.boom.until > state.t;
      const prod = ((m.prod[g] || 0) / 24) * pf * (boom ? 2.2 : 1);
      let cons = (m.cons[g] || 0) / 24;
      if (m.hq && g === 'armaments' && state.wars.some((w) => w.a === m.faction || w.b === m.faction)) cons *= 2;
      const cap = m.target[g] * 2.2;
      m.stock[g] = clamp(m.stock[g] + prod - cons, 0, cap);
    }
    const shortages = Object.keys(m.cons).filter((g) => m.cons[g] > 0 && (m.stock[g] ?? 0) < m.cons[g] * 0.4).length;
    m.stability = clamp(m.stability + (shortages ? -0.15 * shortages : 0.08), 5, 95);
  }
}

function samplePrices(state) {
  for (const m of state.moorings) {
    m.priceHist = m.priceHist || {};
    for (const g of Object.keys(m.target)) {
      const arr = m.priceHist[g] || (m.priceHist[g] = []);
      arr.push(priceOf(m, g));
      if (arr.length > 96) arr.shift();
    }
  }
}

// --- NPC traffic -------------------------------------------------------------

function spawnCaravans(state) {
  const rng = tickRng(state);
  for (const edge of state.edges) {
    if (state.caravans.length >= 45) break;
    const A = mooringById(state, edge.a), B = mooringById(state, edge.b);
    const goods = new Set([...Object.keys(A.target), ...Object.keys(B.target)]);
    for (const g of goods) {
      if (A.stock[g] == null || B.stock[g] == null) continue;
      const pa = priceOf(A, g), pb = priceOf(B, g);
      if (!pa || !pb) continue;
      const margin = (pb - pa) / pa;
      const costFloor = 0.14 + (isStormed(state, edge) ? 0.08 : 0) + (warOnEdge(state, edge) ? 0.16 : 0);
      if (margin <= costFloor) continue;
      if (A.stock[g] < A.target[g] * 0.7 || B.stock[g] > B.target[g] * 1.05) continue;
      const qty = Math.min(
        Math.floor(A.stock[g] - A.target[g] * 0.6),
        Math.ceil(B.target[g] * 1.25 - B.stock[g]),
        rngInt(rng, 8, 26),
      );
      if (qty < 4) continue;
      if ((isStormed(state, edge) || warOnEdge(state, edge)) && rngChance(rng, 0.5)) continue;
      const hours = Math.max(2, Math.round(legHours(state, edge) * 1.15));
      A.stock[g] -= qty;
      state.caravans.push({ id: uid('cv'), a: edge.a, b: edge.b, edgeId: edge.id, good: g, qty, t0: state.t, tArrive: state.t + hours });
      const tax = FACTION_MAP[A.faction]?.tax ?? 0.03;
      const fstate = state.factions.find((f) => f.id === A.faction);
      if (fstate) { fstate.treasury += qty * pa * tax; fstate.tradeVolume += qty; }
    }
  }
}

function moveCaravans(state) {
  for (let i = state.caravans.length - 1; i >= 0; i--) {
    const cv = state.caravans[i];
    if (cv.tArrive > state.t) continue;
    state.caravans.splice(i, 1);
    const B = mooringById(state, cv.b);
    const edge = state.edges.find((e) => e.id === cv.edgeId);
    let qty = cv.qty;
    if (edge && isStormed(state, edge) && Math.random() < 0.12) qty = Math.floor(qty * 0.5);
    B.stock[cv.good] = Math.min((B.stock[cv.good] || 0) + qty, B.target[cv.good] * 2.2);
  }
}

// --- Politics & world events ---------------------------------------------------

const REL_BASES = {
  'concord|syndicate': -45, 'verdant|syndicate': -30, 'choir|concord': 10, 'choir|verdant': 25,
  'union|concord': 15, 'union|verdant': 20, 'union|choir': 15, 'union|syndicate': -10,
};

// Daily finance: shareholders get paid, crews get paid (or they leave).
function dailyFinance(state, rng) {
  const p = state.player;
  let dividends = 0;
  for (const [mooringId, inv] of Object.entries(p.investments)) {
    const m = mooringById(state, mooringId);
    if (!m || !inv.shares) continue;
    dividends += shareDividend(state, m, inv.good) * inv.shares;
  }
  if (dividends > 0) {
    p.credits += dividends;
    p.stats.dividends += dividends;
    p.stats.earnedTotal += dividends;
  }
  const wages = p.crew.reduce((s, c) => s + c.wage, 0);
  if (wages > 0) {
    if (p.credits >= wages) {
      p.credits -= wages;
    } else if (p.crew.length) {
      const gone = p.crew.splice(rngInt(rng, 0, p.crew.length - 1), 1)[0];
      addLog(state, 'crew', `💸 Wages ran dry — ${gone.name} walks off the ship without a word.`);
      bus.emit('crew-desert', gone);
    }
  }
}

// Rival captains live in the same world: they grow, profiteer, and make news.
function stepRivals(state, rng) {
  for (const r of state.rivals) {
    const atWar = state.wars.some((w) => w.a === r.faction || w.b === r.faction);
    const growth = (150 + r.aggression * 420) * (0.55 + rng() * 0.9) * (atWar ? 1.5 : 1);
    r.worth = Math.round(r.worth + growth);
    if (rngChance(rng, 0.06)) {
      const feats = [
        `${r.name} delivered a blockade run that bards will exaggerate.`,
        `${r.name} bought out a spice caravan whole.`,
        `${r.name} was seen refitting at ${rngPick(rng, state.moorings.filter((m) => m.shipyard)).name}.`,
        `${r.name} lost a hold to pirates and laughed about it.`,
      ];
      addLog(state, 'rival', `⛵ ${rngPick(rng, feats)}`);
    }
  }
}

function politicsStep(state) {
  const rng = tickRng(state);
  dailyFinance(state, rng);
  stepRivals(state, rng);
  for (const f of state.factions) {
    const owned = state.moorings.filter((m) => m.faction === f.id);
    const income = owned.reduce((s, m) => s + m.pop * 0.04, 0) + f.tradeVolume * 0.02;
    const upkeep = state.wars.some((w) => w.a === f.id || w.b === f.id) ? 260 : 40;
    f.treasury += income - upkeep;
    f.tradeVolume = 0;
  }
  for (const [k, v] of Object.entries(state.relations)) {
    const [a, b] = k.split('|');
    const atWar = state.wars.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
    if (atWar) {
      state.relations[k] = Math.min(v, -60) + (rng() < 0.1 ? 1 : 0);
      continue;
    }
    const base = REL_BASES[k] ?? 5;
    state.relations[k] = clamp(v + clamp(base - v, -2, 2) * 0.15 + (rng() * 3 - 1.5), -100, 100);
  }
  // Provocations: hostile pairs trade insults and seized cargo, sliding toward war.
  for (const [k, v] of Object.entries(state.relations)) {
    const base = REL_BASES[k] ?? 5;
    if (base < -20 && v < -25 && rngChance(rng, 0.12)) {
      const [a, b] = k.split('|');
      state.relations[k] = clamp(v - rngInt(rng, 4, 9), -100, 100);
      addLog(state, 'politics', `🗯️ Incident: ${FACTION_MAP[a].short} and ${FACTION_MAP[b].short} trade accusations over a seized caravan.`);
    }
  }
  for (const [k, v] of Object.entries(state.relations)) {
    const [a, b] = k.split('|');
    if (v < -55 && !state.wars.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a))) {
      const fa = state.factions.find((f) => f.id === a), fb = state.factions.find((f) => f.id === b);
      if (fa.treasury > 3000 && fb.treasury > 3000 && rngChance(rng, 0.25 + (fa.aggression + fb.aggression) * 0.2)) {
        state.wars.push({ a, b, since: state.t });
        addLog(state, 'war', `⚔️ War declared: ${FACTION_MAP[a].name} vs ${FACTION_MAP[b].name}. Lanes between their territories grow dangerous.`);
        bus.emit('war', { a, b });
      }
    }
  }
  for (const w of [...state.wars]) {
    const days = (state.t - w.since) / 24;
    const fa = state.factions.find((f) => f.id === w.a), fb = state.factions.find((f) => f.id === w.b);
    if (days > 9 && (fa.treasury < 2500 || fb.treasury < 2500 || rngChance(rng, 0.12))) {
      state.wars.splice(state.wars.indexOf(w), 1);
      state.relations[relKey(w.a, w.b)] = -15;
      const tribute = rngInt(rng, 400, 900);
      fa.treasury -= tribute / 2; fb.treasury -= tribute / 2;
      state.treaties.push({ a: w.a, b: w.b, t: state.t });
      addLog(state, 'peace', `🕊️ Treaty signed between ${FACTION_MAP[w.a].short} and ${FACTION_MAP[w.b].short}. Both treasuries bleed for peace.`);
      bus.emit('treaty', w);
    }
  }
  for (const m of state.moorings) {
    if (m.stability < 30 && !(m.riotUntil > state.t) && rngChance(rng, 0.3)) {
      m.riotUntil = state.t + 48;
      m.stability = 40;
      m.news = 'Riots — production halved';
      addLog(state, 'riot', `🔥 Riots erupt at ${m.name}: stores ran empty and the docks went quiet.`);
      bus.emit('world-event', { kind: 'riot', mooring: m.id });
    }
    if (m.boom && m.boom.until <= state.t) { m.boom = null; m.news = ''; }
  }
  if (rngChance(rng, 0.16)) {
    const withProd = state.moorings.filter((x) => Object.keys(x.prod).length > 0);
    if (withProd.length) {
      const m = rngPick(rng, withProd);
      const g = rngPick(rng, Object.keys(m.prod));
      m.boom = { g, until: state.t + 72 };
      m.news = `${GOODS[g].name} boom — output doubled`;
      addLog(state, 'boom', `📈 ${GOODS[g].name} boom at ${m.name}: ${GOODS[g].icon} output doubles for three days.`);
      bus.emit('world-event', { kind: 'boom', mooring: m.id });
    }
  }
}

function shroudTide(state) {
  const day = dayOf(state.t);
  if (day % 30 !== 0 || day < 2) return;
  const rng = tickRng(state);
  const chosen = [...state.edges].sort(() => rng() - 0.5).slice(0, 7);
  for (const e of chosen) e.stormUntil = state.t + rngInt(rng, 8, 16) * 24;
  addLog(state, 'tide', `🌫️ Shroud tide! Storm-walls roll across ${chosen.length} lanes. Old routes turn dangerous; fresh scarcity pays.`);
  bus.emit('tide', {});
  const active = state.anomalies.filter((a) => !a.salvaged).length;
  if (active < 4) {
    const m = rngPick(rng, state.moorings.filter((x) => !x.hq));
    const ang = rng() * Math.PI * 2, r = 70 + rng() * 60;
    state.anomalies.push({
      id: uid('anom'), nearMooring: m.id,
      x: clamp(m.x + Math.cos(ang) * r, 20, 1180),
      y: clamp(m.y + Math.sin(ang) * r, 20, 800),
      kind: rngPick(rng, ['derelict', 'cache', 'beacon']),
      scanLeft: -1, salvaged: false,
    });
  }
}

// --- Anomalies ---------------------------------------------------------------

export function stepScans(state) {
  const p = state.player;
  for (const a of state.anomalies) {
    if (a.scanLeft > 0 && p.phase === 'dock' && a.nearMooring === p.mooring) {
      a.scanLeft--;
      if (a.scanLeft === 0) resolveAnomaly(state, a);
    }
  }
}

function addCargoLoot(state, good, n) {
  const p = state.player;
  const space = capacityOf(state) - cargoCount(p);
  const put = Math.max(0, Math.min(n, space));
  if (put > 0) p.cargo[good] = (p.cargo[good] || 0) + put;
  if (put < n) p.credits += (n - put) * Math.round(GOODS[good].base * 0.6);
}

export function resolveAnomaly(state, a) {
  const rng = tickRng(state);
  const p = state.player;
  a.salvaged = true;
  p.stats.scanned++;
  let out;
  if (a.kind === 'derelict') {
    const unowned = ARTIFACTS.filter((ar) => !state.artifacts[ar.id]);
    if (unowned.length && rngChance(rng, 0.65)) {
      const ar = rngPick(rng, unowned);
      state.artifacts[ar.id] = state.t;
      p.stats.artifacts++;
      out = `Artifact recovered: ${ar.icon} ${ar.name}.`;
      bus.emit('artifact', ar);
    } else {
      const n = rngInt(rng, 2, 4);
      addCargoLoot(state, 'relics', n);
      out = `The derelict yields ${n} relics.`;
    }
  } else if (a.kind === 'cache') {
    const c = rngInt(rng, 300, 900);
    p.credits += c;
    out = `A smuggler's cache: ${c} g in old coin.`;
  } else {
    const c = rngInt(rng, 120, 300);
    p.credits += c;
    p.rep.choir += 3;
    out = `A Choir beacon, still singing. +${c} g salvage, +3 Choir reputation.`;
    bus.emit('rep', { faction: 'choir' });
  }
  addLog(state, 'artifact', `🏺 ${out}`);
  bus.emit('salvage', { anomaly: a, out });
}

// --- The tick ------------------------------------------------------------------

export function tickOnce(state, opts = {}) {
  const coarse = !!opts.coarse;
  state.t++;

  if (!coarse && state.player.phase === 'travel' && !state.pendingEncounter) stepTravel(state);

  if (state.t % 2 === 0) spawnCaravans(state);
  moveCaravans(state);
  economyStep(state);
  if (state.t % 4 === 0) samplePrices(state);

  tickContracts(state);
  if (!coarse) stepScans(state);

  if (hourOf(state.t) === 0) {
    politicsStep(state);
    shroudTide(state);
    if (state.t >= state.contracts.nextRefresh) {
      refreshOffers(state);
      state.contracts.nextRefresh = state.t + 20;
    }
  }
  if (!coarse) bus.emit('tick', { t: state.t });
}

export function runOffline(state, hours) {
  const before = state.wars.length;
  const t0 = state.t;
  for (let i = 0; i < hours; i++) tickOnce(state, { coarse: true });
  return {
    hours,
    wars: Math.max(0, state.wars.length - before),
    treaties: state.treaties.filter((tr) => tr.t > t0).length,
    days: Math.floor(hours / 24),
  };
}
