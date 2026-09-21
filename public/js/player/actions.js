// Every verb the player can perform. Actions validate, mutate state, emit bus
// events, and log. The UI never mutates state directly.

import { bus } from '../core/bus.js';
import { clamp, fmtMoney, uid } from '../core/util.js';
import { GOODS } from '../data/goods.js';
import { FACTION_MAP } from '../data/factions.js';
import { mooringById, edgeBetween, generateWorld, START_MOORING } from '../world/gen.js';
import {
  priceOf, buyPrice, sellPrice, spreadFor, capacityOf, tankCapOf, maxHullOf,
  cargoCount, fuelCostOf, findRoute, UPGRADES, netWorth,
} from '../sim/economy.js';
import { depart, addLog } from '../sim/sim.js';
import { describe } from '../sim/contracts.js';

export const LICENSE_COST = 2000;
export const REP_FOR_LICENSE = 20;

function guardDocked(state) {
  return state.player.phase === 'dock' && !state.pendingEncounter;
}

// --- Movement ---------------------------------------------------------------

export function travelTo(state, targetId) {
  const p = state.player;
  if (p.phase !== 'dock') return { ok: false, reason: 'Already underway.' };
  if (targetId === p.mooring) return { ok: false, reason: 'You are already docked here.' };

  const direct = edgeBetween(state, p.mooring, targetId);
  if (direct) {
    const res = depart(state, p.mooring, direct);
    if (!res.ok) return res;
    addLog(state, 'travel', `🧭 Underway: ${mooringById(state, direct.a === p.mooring ? direct.b : direct.a).name} — ${Math.round(direct.len)}h lane.`);
    bus.emit('travel', {});
    return { ok: true };
  }

  const route = findRoute(state, p.mooring, targetId);
  if (!route || route.path.length < 2) return { ok: false, reason: 'No charted route.' };
  // Fuel check over the full route.
  let fuelNeeded = 0;
  for (const eid of route.edgeIds) fuelNeeded += fuelCostOf(state.edges.find((e) => e.id === eid), p.ship.engine);
  if (p.fuel < fuelNeeded) return { ok: false, reason: `Route needs ${Math.ceil(fuelNeeded)} embers; you carry ${Math.floor(p.fuel)}.` };

  const firstEdgeId = route.edgeIds.shift();
  const firstEdge = state.edges.find((e) => e.id === firstEdgeId);
  const res = depart(state, p.mooring, firstEdge);
  if (!res.ok) return res;
  p.travel.route = route.edgeIds.map((eid, i) => ({
    edgeId: eid,
    from: route.path[i + 1],
  }));
  addLog(state, 'travel', `🧭 Course plotted for ${mooringById(state, targetId).name}: ${route.path.length - 1} legs, ~${Math.round(fuelNeeded)} embers.`);
  bus.emit('travel', {});
  return { ok: true };
}

// --- Trading ---------------------------------------------------------------

export function buyGood(state, good, qty) {
  if (!guardDocked(state)) return { ok: false, reason: 'Cannot trade while underway.' };
  const p = state.player;
  const m = mooringById(state, p.mooring);
  const price = buyPrice(m, good);
  if (price == null) return { ok: false, reason: 'Not traded here.' };
  const space = capacityOf(state) - cargoCount(p);
  qty = Math.min(qty, space);
  if (qty <= 0) return { ok: false, reason: 'No cargo space left.' };
  if (GOODS[good].restricted && !p.licenses[m.faction]) {
    return { ok: false, reason: `${GOODS[good].name} requires a ${FACTION_MAP[m.faction].short} trading license.` };
  }
  const maxAfford = Math.floor((p.credits - 0.01) / price);
  qty = Math.min(qty, maxAfford);
  if (qty <= 0) return { ok: false, reason: 'Not enough gilds.' };

  const cost = Math.round(price * qty * 100) / 100;
  p.credits = Math.round((p.credits - cost) * 100) / 100;
  p.cargo[good] = (p.cargo[good] || 0) + qty;
  m.stock[good] = Math.max(0, m.stock[good] - qty);
  p.stats.trades++;
  p.stats.spentTotal += cost;
  noteCargoCost(state, good, qty, price);
  if (!p.flags.tutorialBuy) p.flags.tutorialBuy = true;
  addLog(state, 'trade', `⬆️ Bought ${qty} ${GOODS[good].name.toLowerCase()} @ ${price} g at ${m.name} (${fmtMoney(cost)}).`);
  bus.emit('trade', { good, qty, cost, dir: 'buy' });
  return { ok: true, qty, cost };
}

export function sellGood(state, good, qty) {
  if (!guardDocked(state)) return { ok: false, reason: 'Cannot trade while underway.' };
  const p = state.player;
  const m = mooringById(state, p.mooring);
  const price = sellPrice(m, good);
  if (price == null) return { ok: false, reason: 'Not traded here.' };
  if (GOODS[good].restricted && !p.licenses[m.faction]) {
    return { ok: false, reason: `${GOODS[good].name} requires a ${FACTION_MAP[m.faction].short} trading license here.` };
  }
  qty = Math.min(qty, p.cargo[good] || 0);
  if (qty <= 0) return { ok: false, reason: 'Nothing to sell.' };

  // Profit accounting uses average cost if recorded, else base price.
  const avg = p.cargoCost?.[good] || GOODS[good].base;
  const revenue = Math.round(price * qty * 100) / 100;
  const profit = Math.round((price - avg) * qty);
  p.credits = Math.round((p.credits + revenue) * 100) / 100;
  p.cargo[good] -= qty;
  if (p.cargo[good] <= 0) { delete p.cargo[good]; if (p.cargoCost) delete p.cargoCost[good]; }
  m.stock[good] = Math.min(m.stock[good] + qty, m.target[good] * 2.2);
  p.stats.trades++;
  p.stats.profit += profit;
  p.stats.earnedTotal += revenue;
  if (state.wars.some((w) => w.a === m.faction || w.b === m.faction)) p.stats.profitWar += Math.max(0, profit);
  if (!p.flags.tutorialSell) p.flags.tutorialSell = true;
  const tax = Math.round(revenue * spreadFor(m) * 100) / 100;
  const fstate = state.factions.find((f) => f.id === m.faction);
  if (fstate) fstate.treasury += tax;
  addLog(state, 'trade', `⬇️ Sold ${qty} ${GOODS[good].name.toLowerCase()} @ ${price} g at ${m.name} (${fmtMoney(revenue)}, margin ${fmtMoney(profit)}).`);
  bus.emit('trade', { good, qty, revenue, profit, dir: 'sell' });
  return { ok: true, qty, revenue, profit };
}

// Record per-unit acquisition cost for margin reporting.
export function noteCargoCost(state, good, qty, unitCost) {
  state.player.cargoCost = state.player.cargoCost || {};
  const have = state.player.cargo[good] || 0;
  const prevAvg = state.player.cargoCost[good] || unitCost;
  state.player.cargoCost[good] = have > 0 ? (prevAvg * (have - qty) + unitCost * qty) / have : unitCost;
}

// --- Services ---------------------------------------------------------------

export function refuel(state, qty) {
  if (!guardDocked(state)) return { ok: false, reason: 'Cannot refuel while underway.' };
  const p = state.player;
  const m = mooringById(state, p.mooring);
  const price = buyPrice(m, 'embers');
  if (price == null) return { ok: false, reason: 'No ember depot here.' };
  const space = tankCapOf(state) - p.fuel;
  qty = Math.max(0, Math.min(qty, Math.floor(space), Math.floor(p.credits / price)));
  if (qty <= 0) return { ok: false, reason: 'Tanks full or no gilds.' };
  const cost = Math.round(price * qty);
  p.credits -= cost;
  p.fuel = Math.round((p.fuel + qty) * 10) / 10;
  m.stock.embers = Math.max(0, (m.stock.embers || 0) - qty * 0.5); // depots run deeper than markets
  addLog(state, 'trade', `🔥 Refueled ${qty} embers @ ${price} g (${fmtMoney(cost)}).`);
  bus.emit('refuel', { qty, cost });
  return { ok: true, qty, cost };
}

export function repair(state) {
  if (!guardDocked(state)) return { ok: false, reason: 'Cannot repair while underway.' };
  const p = state.player;
  const m = mooringById(state, p.mooring);
  if (!m.shipyard) return { ok: false, reason: 'No shipyard at this mooring.' };
  const missing = maxHullOf(state) - p.hull;
  if (missing <= 0) return { ok: false, reason: 'Hull is sound.' };
  const cost = Math.round(missing * 2.2);
  if (p.credits < cost) return { ok: false, reason: `Repairs cost ${fmtMoney(cost)}.` };
  p.credits -= cost;
  p.hull = maxHullOf(state);
  addLog(state, 'trade', `🛠️ Hull repaired at ${m.name} for ${fmtMoney(cost)}.`);
  bus.emit('repair', { cost });
  return { ok: true, cost };
}

export function buyUpgrade(state, key) {
  if (!guardDocked(state)) return { ok: false, reason: 'The shipyard is planets behind you.' };
  const p = state.player;
  const m = mooringById(state, p.mooring);
  if (!m.shipyard) return { ok: false, reason: 'No shipyard at this mooring.' };
  const spec = UPGRADES[key];
  const tier = p.ship[key];
  if (tier >= spec.costs.length) return { ok: false, reason: 'Already at maximum.' };
  const cost = spec.costs[tier];
  if (p.credits < cost) return { ok: false, reason: `Costs ${fmtMoney(cost)}.` };
  p.credits -= cost;
  p.ship[key] = tier + 1;
  p.stats.invested = (p.stats.invested || 0) + cost;
  if (key === 'hull') p.hull = Math.min(p.hull + 20, maxHullOf(state));
  addLog(state, 'upgrade', `⬆️ ${spec.name} fitted: tier ${tier + 1} (${fmtMoney(cost)}).`);
  bus.emit('upgrade', { key, tier: tier + 1 });
  return { ok: true };
}

export function acquireLicense(state, factionId) {
  if (!guardDocked(state)) return { ok: false, reason: 'Not while underway.' };
  const p = state.player;
  if (p.licenses[factionId]) return { ok: false, reason: 'Already licensed.' };
  if ((p.rep[factionId] || 0) < REP_FOR_LICENSE) return { ok: false, reason: `Requires Friendly standing (+${REP_FOR_LICENSE} rep) with the ${FACTION_MAP[factionId].short}.` };
  if (p.credits < LICENSE_COST) return { ok: false, reason: `The charter fee is ${fmtMoney(LICENSE_COST)}.` };
  p.credits -= LICENSE_COST;
  p.licenses[factionId] = true;
  addLog(state, 'faction', `📜 ${FACTION_MAP[factionId].name} trading license acquired. Their restricted goods and markets open to you.`);
  bus.emit('license', { faction: factionId });
  return { ok: true };
}

// --- Contracts ---------------------------------------------------------------

export function acceptContract(state, offerId) {
  if (!guardDocked(state)) return { ok: false, reason: 'Not while underway.' };
  const p = state.player;
  const offers = state.contracts.offers;
  const idx = offers.findIndex((o) => o.id === offerId);
  if (idx === -1) return { ok: false, reason: 'Offer expired.' };
  if (state.contracts.active.length >= 3) return { ok: false, reason: 'Contract ledger is full (3 active).' };
  const offer = offers[idx];
  if (offer.kind === 'passenger' && capacityOf(state) - cargoCount(p) < 1) {
    return { ok: false, reason: 'No free berth for a passenger.' };
  }
  offers.splice(idx, 1);
  const active = {
    ...offer,
    acceptedAt: state.t,
    toName: mooringById(state, offer.to).name,
    fromName: offer.from ? mooringById(state, offer.from).name : null,
  };
  if (offer.kind === 'passenger') {
    active.passenger = { id: offer.id, name: offer.name };
    p.passengers.push(active.passenger);
  }
  if (offer.kind === 'relief' && offer.advance) {
    p.credits += offer.advance;
    p.cargo[offer.good] = (p.cargo[offer.good] || 0) + offer.qty;
    const m = mooringById(state, offer.from);
    m.stock[offer.good] = Math.max(0, (m.stock[offer.good] || 0) - offer.qty);
    addLog(state, 'contract', `💰 Relief advance: +${fmtMoney(offer.advance)} and ${offer.qty} crates of grain loaded.`);
  }
  state.contracts.active.push(active);
  if (!p.flags.tutorialContract) p.flags.tutorialContract = true;
  addLog(state, 'contract', `✍️ Contract accepted: ${describe(active)}. Due day ${Math.floor(active.deadline / 24) + 1}.`);
  bus.emit('contract-accept', active);
  return { ok: true };
}

export function deliverContract(state, contractId) {
  if (!guardDocked(state)) return { ok: false, reason: 'Not while underway.' };
  const p = state.player;
  const idx = state.contracts.active.findIndex((c) => c.id === contractId);
  if (idx === -1) return { ok: false, reason: 'No such contract.' };
  const c = state.contracts.active[idx];
  if (p.mooring !== c.to) return { ok: false, reason: 'Not at the delivery mooring.' };
  if (c.good && (p.cargo[c.good] || 0) < c.qty) return { ok: false, reason: `Cargo short: need ${c.qty} ${GOODS[c.good].name.toLowerCase()}.` };

  if (c.good) {
    p.cargo[c.good] -= c.qty;
    if (p.cargo[c.good] <= 0) delete p.cargo[c.good];
    const m = mooringById(state, c.to);
    m.stock[c.good] = Math.min((m.stock[c.good] || 0) + c.qty, m.target[c.good] * 2.2);
  }
  if (c.kind === 'passenger') p.passengers = p.passengers.filter((x) => x.id !== c.id);

  p.credits += c.reward;
  p.stats.delivered++;
  p.stats.earnedTotal += c.reward;
  const repGain = c.repReward;
  p.rep[c.repFaction] = clamp((p.rep[c.repFaction] || 0) + repGain, -100, 100);
  if (c.kind === 'blockade') {
    p.stats.blockades++;
    p.rep[c.riskFaction] = clamp((p.rep[c.riskFaction] || 0) - 3, -100, 100);
    addLog(state, 'contract', `🏴 Blockade delivered to ${c.toName}. ${FACTION_MAP[c.repFaction].short} +${repGain}, ${FACTION_MAP[c.riskFaction].short} −3.`);
  } else {
    addLog(state, 'contract', `✅ Contract complete: ${describe(c)}. +${fmtMoney(c.reward)}, ${FACTION_MAP[c.repFaction].short} +${repGain}.`);
  }
  state.contracts.active.splice(idx, 1);
  state.contracts.history.unshift({ id: c.id, kind: c.kind, result: 'done', t: state.t });
  if (state.contracts.history.length > 40) state.contracts.history.length = 40;
  bus.emit('contract-deliver', c);
  return { ok: true, reward: c.reward };
}

export function abandonContract(state, contractId) {
  if (!guardDocked(state)) return { ok: false, reason: 'Not while underway.' };
  const idx = state.contracts.active.findIndex((c) => c.id === contractId);
  if (idx === -1) return { ok: false, reason: 'No such contract.' };
  const c = state.contracts.active[idx];
  state.contracts.active.splice(idx, 1);
  state.contracts.history.unshift({ id: c.id, kind: c.kind, result: 'abandoned', t: state.t });
  state.player.rep[c.repFaction] = clamp((state.player.rep[c.repFaction] || 0) - 3, -100, 100);
  if (c.kind === 'passenger' && c.passenger) state.player.passengers = state.player.passengers.filter((x) => x.id !== c.id);
  addLog(state, 'contract', `🚪 Contract abandoned: ${describe(c)}. ${FACTION_MAP[c.repFaction].short} reputation −3.`);
  bus.emit('contract-abandon', c);
  return { ok: true };
}

export function jettison(state, good, qty) {
  if (!guardDocked(state)) return { ok: false, reason: 'Not while underway.' };
  const p = state.player;
  qty = Math.min(qty, p.cargo[good] || 0);
  if (qty <= 0) return { ok: false, reason: 'Nothing to jettison.' };
  p.cargo[good] -= qty;
  if (p.cargo[good] <= 0) delete p.cargo[good];
  addLog(state, 'trade', `🌊 Jettisoned ${qty} ${GOODS[good].name.toLowerCase()} into the clouds.`);
  bus.emit('trade', { good, qty, dir: 'jettison' });
  return { ok: true };
}

// --- Anomalies ---------------------------------------------------------------

export function scanAnomaly(state, anomalyId) {
  if (!guardDocked(state)) return { ok: false, reason: 'Not while underway.' };
  const p = state.player;
  if (p.ship.scanner < 1) return { ok: false, reason: 'Requires a Scanner Array (L1) — fit one at a shipyard.' };
  const a = state.anomalies.find((x) => x.id === anomalyId);
  if (!a || a.salvaged) return { ok: false, reason: 'Nothing left to scan.' };
  if (a.nearMooring !== p.mooring) return { ok: false, reason: 'You must be docked at the adjacent mooring.' };
  if (a.scanLeft > 0) return { ok: false, reason: 'Scan already in progress.' };
  a.scanLeft = 2;
  addLog(state, 'artifact', `📡 Scanning anomaly near ${mooringById(state, p.mooring).name}… (2h)`);
  bus.emit('scan-start', a);
  return { ok: true };
}

// --- Encounter resolution -------------------------------------------------------

export function resolveEncounterChoice(state, choiceIdx) {
  const enc = state.pendingEncounter;
  if (!enc) return null;
  const choice = enc.choices[choiceIdx];
  if (!choice) return null;
  const result = choice.resolve(state);
  state.pendingEncounter = null;
  state.paused = false;
  bus.emit('encounter-resolved', { enc, result });
  addLog(state, 'encounter', `${enc.icon} ${enc.title}: ${result.text}`);
  return result;
}

// --- Meta / lifecycle ---------------------------------------------------------------

export function checkCatastrophe(state) {
  // Hull at zero: salvage rescue, never a hard game-over.
  const p = state.player;
  if (p.hull > 0) return null;
  const lost = [];
  for (const [g, n] of Object.entries(p.cargo)) {
    const take = Math.ceil(n * 0.3);
    p.cargo[g] = n - take;
    if (p.cargo[g] <= 0) delete p.cargo[g];
    lost.push(`${take} ${GOODS[g].name.toLowerCase()}`);
  }
  p.hull = Math.round(maxHullOf(state) * 0.25);
  p.travel = null;
  p.phase = 'dock';
  const fee = Math.round(p.credits * 0.1);
  p.credits -= fee;
  const near = state.moorings
    .map((m) => ({ m, d: Math.hypot(m.x - (mooringById(state, p.mooring)?.x || 600), m.y - (mooringById(state, p.mooring)?.y || 400)) }))
    .sort((a, b) => a.d - b.d)[1]?.m || mooringById(state, START_MOORING);
  p.mooring = near.id;
  addLog(state, 'damage', `💥 Hull breach! Salvage tugs tow you to ${near.name}. Lost ${lost.join(', ') || 'nothing'} and ${fmtMoney(fee)} in fees.`);
  bus.emit('catastrophe', { near: near.id });
  return { near: near.id, lost, fee };
}

export function newGame(seed, meta = {}) {
  const state = generateWorld(seed, meta);
  return state;
}

export { netWorth };
