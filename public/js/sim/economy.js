// Pure economic math shared by the tick engine, contracts, encounters and UI.
// Leaf module: imports only data + world queries, never sim.js.

import { clamp } from '../core/util.js';
import { GOODS } from '../data/goods.js';
import { FACTION_MAP } from '../data/factions.js';
import { mooringById, neighborsOf } from '../world/gen.js';

export const UPGRADES = {
  cargo:   { name: 'Cargo Hold',   icon: '📦', costs: [1200, 3800, 9500, 24000], values: [20, 36, 56, 90, 150], unit: 'crates', desc: 'Bigger holds carry more profit per leg.' },
  engine:  { name: 'Engines',      icon: '🌀', costs: [900, 2600, 7000, 18000], values: [1, 1.18, 1.36, 1.54, 1.72], unit: '× speed', desc: 'Shorter legs; harder to catch, easier to flee.' },
  tank:    { name: 'Ember Tanks',  icon: '🔥', costs: [800, 2200, 6000, 15000], values: [40, 70, 110, 170, 260], unit: 'fuel', desc: 'Longer range between refuels.' },
  hull:    { name: 'Hull Plating', icon: '🛡️', costs: [1000, 3000, 8000, 20000], values: [100, 120, 145, 175, 210], unit: 'hull', desc: 'More integrity, better odds in a fight.' },
  scanner: { name: 'Scanner Array', icon: '📡', costs: [1500, 4500, 12000], values: [0, 1, 2, 3], unit: 'range', desc: 'L1: adjacent markets + salvage. L2: 2-hop intel. L3: the whole Reach.' },
};

export const capacityOf = (state) => UPGRADES.cargo.values[state.player.ship.cargo];
export const tankCapOf = (state) => UPGRADES.tank.values[state.player.ship.tank];
export const maxHullOf = (state) => UPGRADES.hull.values[state.player.ship.hull];
export const speedMultOf = (state) => UPGRADES.engine.values[state.player.ship.engine];
export const scannerOf = (state) => state.player.ship.scanner;
export const cargoCount = (p) => Object.values(p.cargo).reduce((a, b) => a + b, 0) + p.passengers.length;

export function priceOf(m, g) {
  const target = m.target[g];
  if (!target) return null;
  const ratio = Math.max(m.stock[g] || 0, 0.0001) / target;
  const mult = clamp(Math.pow(ratio, -0.55), 0.3, 3.2);
  return Math.round(GOODS[g].base * mult * 10) / 10;
}

export function spreadFor(m) {
  return 0.02 + (FACTION_MAP[m.faction]?.tax ?? 0.03);
}

export function buyPrice(m, g) { const p = priceOf(m, g); return p == null ? null : Math.round(p * (1 + spreadFor(m)) * 10) / 10; }
export function sellPrice(m, g) { const p = priceOf(m, g); return p == null ? null : Math.round(p * (1 - spreadFor(m)) * 10) / 10; }

export const isStormed = (state, edge) => edge.stormUntil > state.t;

export function warOnEdge(state, edge) {
  const fa = mooringById(state, edge.a)?.faction;
  const fb = mooringById(state, edge.b)?.faction;
  return state.wars.some((w) => (w.a === fa && w.b === fb) || (w.a === fb && w.b === fa));
}

export function legHours(state, edge) {
  return isStormed(state, edge) ? edge.len * 1.6 : edge.len;
}

export const fuelCostOf = (edge, engTier) => Math.round(edge.len * 0.9 * Math.pow(0.94, engTier) * 10) / 10;

// Dijkstra over travel hours.
export function findRoute(state, fromId, toId) {
  if (fromId === toId) return { hours: 0, path: [fromId], edges: [] };
  const distH = new Map([[fromId, 0]]);
  const prev = new Map();
  const visited = new Set();
  for (;;) {
    let cur = null, best = Infinity;
    for (const [id, d] of distH) if (!visited.has(id) && d < best) { best = d; cur = id; }
    if (cur == null || cur === toId) break;
    visited.add(cur);
    for (const { edge, other } of neighborsOf(state, cur)) {
      const nd = best + legHours(state, edge);
      if (nd < (distH.get(other) ?? Infinity)) {
        distH.set(other, nd);
        prev.set(other, { from: cur, edge });
      }
    }
  }
  if (!distH.has(toId)) return null;
  const path = [toId]; const edgeIds = [];
  let cur = toId;
  while (cur !== fromId) {
    const p = prev.get(cur);
    edgeIds.unshift(p.edge.id);
    path.unshift(p.from);
    cur = p.from;
  }
  return { hours: distH.get(toId), path, edgeIds };
}

// --- Crew --------------------------------------------------------------------

export function hasTrait(state, traitId) {
  return state.player.crew.some((c) => c.trait === traitId);
}

export function crewSlots(state) {
  return 2 + (state.player.ship.cargo >= 2 ? 1 : 0) + (state.player.ship.cargo >= 4 ? 1 : 0);
}

export const SHARE_CAP = 6;
export function sharePrice(m, g) {
  return Math.round((m.prod[g] || 0) * GOODS[g].base * 1.15);
}
export function shareDividend(state, m, g) {
  const perShareDaily = (m.prod[g] || 0) / 10; // one share ≈ a tenth of daily output
  return Math.round(perShareDaily * (sellPrice(m, g) || GOODS[g].base) * 0.2);
}

export function netWorth(state) {
  const p = state.player;
  const m = mooringById(state, p.mooring);
  let cargoVal = 0;
  for (const [g, n] of Object.entries(p.cargo)) cargoVal += (priceOf(m, g) ?? GOODS[g].base) * n;
  return Math.round(p.credits + cargoVal + (p.stats.invested || 0) * 0.6);
}

export function knownMarkets(state) {
  const p = state.player;
  const lvl = scannerOf(state);
  const seen = new Set([p.mooring, ...p.stats.visited]);
  if (lvl >= 3) return state.moorings.map((m) => m.id);
  const hops = lvl === 1 ? 1 : lvl === 2 ? 2 : 0;
  if (hops === 0) return [...seen];
  let frontier = new Set([p.mooring]);
  for (let i = 0; i < hops; i++) {
    const next = new Set();
    for (const id of frontier) for (const { other } of neighborsOf(state, id)) { seen.add(other); next.add(other); }
    frontier = next;
  }
  return [...seen];
}

export function bestArbitrage(state) {
  const known = new Set(knownMarkets(state));
  const out = [];
  for (const edge of state.edges) {
    if (!known.has(edge.a) || !known.has(edge.b)) continue;
    const A = mooringById(state, edge.a), B = mooringById(state, edge.b);
    for (const g of Object.keys(A.target)) {
      if (B.target[g] == null) continue;
      const buy = buyPrice(A, g), sell = sellPrice(B, g);
      if (!buy || !sell) continue;
      const margin = sell - buy;
      if (margin / buy > 0.18 && A.stock[g] > A.target[g] * 0.6) {
        out.push({ good: g, fromId: A.id, toId: B.id, buy, sell, margin, hours: legHours(state, edge) });
      }
    }
  }
  out.sort((x, y) => y.margin / y.buy - x.margin / x.buy);
  return out.slice(0, 4);
}
