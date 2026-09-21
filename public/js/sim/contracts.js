// Contract generation — authored by the world's live state, not by writers.
// Deliveries chase real price gaps; blockade runs chase real wars.

import { hashStr, mulberry32, rngInt, rngPick, rngChance, uid, clamp } from '../core/util.js';
import { GOOD_ORDER, GOODS } from '../data/goods.js';
import { FACTION_MAP } from '../data/factions.js';
import { genPassengerName, PASSENGER_FLAVOR } from '../data/names.js';
import { priceOf, findRoute, cargoCount } from './economy.js';
import { addLog } from './log.js';

function genRng(state) {
  return mulberry32((hashStr(state.meta.seed) ^ Math.imul(state.contracts.nextRefresh + 7, 2246822519)) >>> 0);
}

// One all-pairs Dijkstra cache per refresh (offer generation is the only hot caller).
let hoursCache = null;
let hoursCacheFor = null;
function travelHours(state, a, b) {
  if (hoursCacheFor !== state.contracts.nextRefresh) {
    hoursCache = new Map();
    for (const m of state.moorings) {
      for (const n of state.moorings) {
        if (n.id <= m.id) continue;
        const r = findRoute(state, m.id, n.id);
        const h = r ? r.hours : Infinity;
        hoursCache.set(`${m.id}|${n.id}`, h);
        hoursCache.set(`${n.id}|${m.id}`, h);
      }
    }
    hoursCacheFor = state.contracts.nextRefresh;
  }
  if (a === b) return 0;
  return hoursCache.get(`${a}|${b}`) ?? Infinity;
}

function makeDelivery(state, rng) {
  const p = state.player;
  // Find a real shortage downstream of a real surplus, near-ish the player.
  const candidates = [];
  for (const src of state.moorings) {
    for (const g of Object.keys(src.target)) {
      if ((src.prod[g] || 0) <= 0) continue;
      if ((src.stock[g] || 0) < src.target[g] * 0.9) continue;
      for (const dst of state.moorings) {
        if (dst.id === src.id || dst.target[g] == null) continue;
        if ((dst.stock[g] || 0) > dst.target[g] * 0.75) continue;
        const pb = priceOf(dst, g), pa = priceOf(src, g);
        if (!pa || !pb || pb / pa < 1.3) continue;
        const hours = travelHours(state, src.id, dst.id);
        if (hours === Infinity || hours > 60) continue;
        const distFromPlayer = travelHours(state, p.mooring, src.id);
        if (distFromPlayer === Infinity || distFromPlayer > 48) continue;
        candidates.push({ src, dst, g, pa, pb, hours });
      }
    }
  }
  if (!candidates.length) return null;
  candidates.sort((x, y) => (y.pb / y.pa) - (x.pb / x.pa));
  const c = candidates[rngInt(rng, 0, Math.min(2, candidates.length - 1))];
  const qty = clamp(Math.round((c.src.stock[c.g] - c.src.target[c.g] * 0.5) / 2), 6, 30);
  const reward = Math.round(qty * (c.pb - c.pa) * 0.85 + 140);
  return {
    id: uid('ct'), kind: 'delivery', good: c.g, qty,
    from: c.src.id, to: c.dst.id,
    reward, repReward: 4, repFaction: c.dst.faction,
    deadline: state.t + Math.ceil(c.hours * 2.2) + 36,
    flavor: `${c.dst.name} is short on ${GOODS[c.g].name.toLowerCase()}; ${c.src.name} has plenty.`,
  };
}

function makeCourier(state, rng) {
  const p = state.player;
  const dest = rngPick(rng, state.moorings.filter((m) => m.id !== p.mooring && travelHours(state, p.mooring, m.id) < 50));
  if (!dest) return null;
  const hours = travelHours(state, p.mooring, dest.id);
  return {
    id: uid('ct'), kind: 'courier',
    from: p.mooring, to: dest.id,
    reward: rngInt(rng, 240, 460), repReward: 4, repFaction: dest.faction,
    deadline: state.t + Math.ceil(hours * 1.6) + 18,
    flavor: 'A sealed dispatch. The seal bears no flag, which is its own answer.',
  };
}

function makePassenger(state, rng) {
  const p = state.player;
  const dest = rngPick(rng, state.moorings.filter((m) => m.id !== p.mooring && travelHours(state, p.mooring, m.id) < 45));
  if (!dest) return null;
  const hours = travelHours(state, p.mooring, dest.id);
  return {
    id: uid('ct'), kind: 'passenger',
    name: genPassengerName(rng), flavorLine: rngPick(rng, PASSENGER_FLAVOR),
    from: p.mooring, to: dest.id,
    reward: rngInt(rng, 200, 440), repReward: 2, repFaction: dest.faction,
    deadline: state.t + Math.ceil(hours * 2.4) + 30,
    flavor: 'One berth, one passenger, no questions.',
  };
}

function makeBlockade(state, rng) {
  const war = rngPick(rng, state.wars);
  if (!war) return null;
  const side = rngChance(rng, 0.5) ? war.a : war.b;
  const other = side === war.a ? war.b : war.a;
  const targets = state.moorings.filter((m) => m.faction === side);
  const dest = rngPick(rng, targets);
  const good = rngChance(rng, 0.5) ? 'armaments' : 'grain';
  const qty = good === 'grain' ? rngInt(rng, 14, 26) : rngInt(rng, 6, 12);
  const hours = travelHours(state, state.player.mooring, dest.id);
  if (hours === Infinity) return null;
  return {
    id: uid('ct'), kind: 'blockade', good, qty,
    from: null, to: dest.id, riskFaction: other,
    reward: Math.round(qty * GOODS[good].base * 2.2 + 250), repReward: 8, repFaction: side,
    deadline: state.t + Math.ceil(hours * 2.4) + 48,
    flavor: `${FACTION_MAP[side].short} lines are starving. Run the blockade; the ${FACTION_MAP[other].short} will remember your face.`,
  };
}

export function refreshOffers(state) {
  const rng = genRng(state);
  const p = state.player;
  const offers = [];

  for (let i = 0; i < 2; i++) {
    const o = makeDelivery(state, rng);
    if (o) offers.push(o);
  }
  if (rngChance(rng, 0.4)) { const o = makeCourier(state, rng); if (o) offers.push(o); }
  if (rngChance(rng, 0.45)) { const o = makePassenger(state, rng); if (o) offers.push(o); }
  if (state.wars.length && rngChance(rng, 0.85)) { const o = makeBlockade(state, rng); if (o) offers.push(o); }

  // Relief work: the world never lets a captain starve (but it does make them work).
  if (p.credits < 150 && cargoCount(p) === 0 && !state.contracts.active.length && !offers.some((o) => o.kind === 'relief')) {
    const near = state.moorings
      .filter((m) => m.id !== p.mooring && m.target.grain && (m.stock.grain || 0) < m.target.grain * 0.6)
      .map((m) => ({ m, h: travelHours(state, p.mooring, m.id) }))
      .filter((x) => x.h < 40)
      .sort((a, b) => a.h - b.h)[0];
    if (near) {
      offers.unshift({
        id: uid('ct'), kind: 'relief', good: 'grain', qty: 10,
        from: p.mooring, to: near.m.id,
        reward: 260, repReward: 5, repFaction: near.m.faction, advance: 300,
        deadline: state.t + Math.ceil(near.h * 2.5) + 30,
        flavor: 'Dockhands\u2019 guild relief run. They front the advance; you haul the grain.',
      });
    }
  }

  state.contracts.offers = offers.slice(0, 5);
}

export function tickContracts(state) {
  const dead = [];
  for (const c of state.contracts.active) {
    if (state.t > c.deadline) dead.push(c);
  }
  for (const c of dead) {
    state.contracts.active.splice(state.contracts.active.indexOf(c), 1);
    state.contracts.history.unshift({ id: c.id, kind: c.kind, result: 'failed', t: state.t });
    state.player.rep[c.repFaction] = clamp((state.player.rep[c.repFaction] || 0) - 6, -100, 100);
    state.player.stats.failed++;
    if (c.kind === 'passenger' && c.passenger) state.player.passengers = state.player.passengers.filter((x) => x.id !== c.id);
    addLog(state, 'contract', `⌛ Contract failed: ${describe(c)}. ${FACTION_MAP[c.repFaction].short} reputation −6.`);
  }
}

export function describe(c) {
  switch (c.kind) {
    case 'delivery': return `deliver ${c.qty} ${GOODS[c.good].name.toLowerCase()} to ${c.toName || c.to}`;
    case 'courier': return `courier dispatch to ${c.toName || c.to}`;
    case 'passenger': return `ferry ${c.name} to ${c.toName || c.to}`;
    case 'blockade': return `blockade run to ${c.toName || c.to}`;
    case 'relief': return `relief run to ${c.toName || c.to}`;
    default: return c.kind;
  }
}
