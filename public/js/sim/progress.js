// Milestones (authored onboarding chain) + achievements (stat-verified goals).

import { bus } from '../core/bus.js';
import { mooringById, START_MOORING } from '../world/gen.js';
import { netWorth, scannerOf } from './economy.js';
import { addLog } from './log.js';

export const MILESTONES = [
  {
    id: 'buy', title: 'Stock the hold',
    desc: 'Buy 8 crates of anything at the market (try grain).',
    reward: 0,
    test: (s) => s.player.stats.trades > 0,
    hint: 'Open the Market tab and use the BUY buttons.',
  },
  {
    id: 'sell', title: 'First margin',
    desc: 'Travel to a neighboring mooring and sell your cargo for a profit.',
    reward: 150,
    test: (s) => s.player.stats.profit > 0,
    hint: 'Click an adjacent mooring on the map, travel there, sell where prices glow warm.',
  },
  {
    id: 'contract', title: 'Sign the ledger',
    desc: 'Accept any contract from the Contracts board.',
    reward: 100,
    test: (s) => s.contracts.active.length > 0 || s.player.stats.delivered > 0,
    hint: 'Contracts tab — factions post what they need. Deadlines are real.',
  },
  {
    id: 'refuel', title: 'Ember discipline',
    desc: 'Refuel your tanks (fuel is bought like any other good).',
    reward: 80,
    test: (s) => s.player.flags.refueled === true,
    hint: 'Ship tab → Refuel. Union wells tend to be cheapest.',
  },
  {
    id: 'upgrade', title: 'A proper ship',
    desc: 'Fit any upgrade at a shipyard (marked ⚓).',
    reward: 0,
    test: (s) => Object.values(s.player.ship).some((v) => v > 0),
    hint: 'Dock at a mooring with a shipyard, Ship tab → Outfitting.',
  },
  {
    id: 'scan', title: 'The sky has pockets',
    desc: 'Fit a Scanner Array and salvage an anomaly.',
    reward: 400,
    test: (s) => s.player.stats.scanned > 0,
    hint: 'Anomalies glitter near moorings. Scanner L1 lets you work them.',
  },
  {
    id: 'friendly', title: 'A name they trust',
    desc: 'Reach Friendly (+20) reputation with any faction.',
    reward: 500,
    test: (s) => Object.values(s.player.rep).some((v) => v >= 20),
    hint: 'Deliver contracts, run relief, answer distress calls.',
  },
];

export const ACHIEVEMENTS = [
  { id: 'first_sale', name: 'Ledger Open', icon: '🖋️', desc: 'Complete your first trade.', test: (s) => s.player.stats.trades >= 1 },
  { id: 'ten_ports', name: 'Ten Ports', icon: '⚓', desc: 'Dock at 10 different moorings.', test: (s) => s.player.stats.visited.length >= 10 },
  { id: 'stormrunner', name: 'Stormrunner', icon: '🌫️', desc: 'Complete 5 legs through stormed lanes.', test: (s) => s.player.stats.storms >= 5 },
  { id: 'war_profiteer', name: 'War Profiteer', icon: '⚔️', desc: 'Bank 4,000 g of wartime margin.', test: (s) => s.player.stats.profitWar >= 4000 },
  { id: 'smuggler', name: 'Ghost of the Blockade', icon: '🏴', desc: 'Complete 3 blockade runs.', test: (s) => s.player.stats.blockades >= 3 },
  { id: 'convoy', name: 'Convoy Captain', icon: '📦', desc: 'Deliver 25 contracts.', test: (s) => s.player.stats.delivered >= 25 },
  { id: 'relic_hunter', name: 'Relic Hunter', icon: '🏺', desc: 'Recover 4 artifacts.', test: (s) => s.player.stats.artifacts >= 4 },
  { id: 'archivist', name: 'Archivist', icon: '📜', desc: 'Recover 10 artifacts.', test: (s) => s.player.stats.artifacts >= 10 },
  { id: 'tycoon', name: 'Merchant of the Reach', icon: '💰', desc: 'Reach a net worth of 75,000 g.', test: (s) => netWorth(s) >= 75000 },
  { id: 'shipwright', name: 'Proper Vessel', icon: '🛠️', desc: 'Fit the third tier of any system.', test: (s) => Object.values(s.player.ship).some((v) => v >= 3) },
  { id: 'eye_of_shroud', name: 'Eye of the Shroud', icon: '📡', desc: 'Fit the full Scanner Array (L3).', test: (s) => scannerOf(s) >= 3 },
  { id: 'dynasty', name: 'Trade Dynasty', icon: '👑', desc: 'Found your dynasty: 200,000 g net worth, 3 licenses, and an Exalted patron.', test: (s) => isDynasty(s) },
];

export function isDynasty(s) {
  return netWorth(s) >= 200000
    && Object.keys(s.player.licenses).length >= 3
    && Object.values(s.player.rep).some((v) => v >= 80);
}

export function checkMilestones(state) {
  const ms = state.milestones;
  if (ms.idx >= MILESTONES.length) return null;
  const cur = MILESTONES[ms.idx];
  if (cur.test(state)) {
    ms.done[cur.id] = state.t;
    ms.idx++;
    if (cur.reward > 0) state.player.credits += cur.reward;
    addLog(state, 'milestone', `🧭 Milestone: ${cur.title}${cur.reward ? ` (+${cur.reward} g)` : ''}`);
    bus.emit('milestone', cur);
    return cur;
  }
  return null;
}

export function checkAchievements(state) {
  const earned = [];
  for (const a of ACHIEVEMENTS) {
    if (state.achievements[a.id]) continue;
    if (a.test(state)) {
      state.achievements[a.id] = state.t;
      earned.push(a);
      addLog(state, 'ach', `🏅 Achievement: ${a.name} — ${a.desc}`);
      bus.emit('achievement', a);
    }
  }
  return earned;
}

export function currentMilestone(state) {
  return state.milestones.idx < MILESTONES.length ? MILESTONES[state.milestones.idx] : null;
}

// Starting location used by UI defaults.
export { START_MOORING };
