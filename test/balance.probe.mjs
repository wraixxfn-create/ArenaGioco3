// Gameplay-balance probe: is the opening fun and viable across seeds?
import { generateWorld, START_MOORING, neighborsOf } from '../public/js/world/gen.js';
import { buyPrice, sellPrice, findRoute, capacityOf } from '../public/js/sim/economy.js';
import { buyGood, sellGood, travelTo } from '../public/js/player/actions.js';
import { tickOnce } from '../public/js/sim/sim.js';
import { refreshOffers } from '../public/js/sim/contracts.js';

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
let goodOpenings = 0, weakOpenings = 0;

for (const seed of SEEDS) {
  const st = generateWorld(seed);
  refreshOffers(st);
  // Best 1-leg arbitrage from start with a 20-crate hold.
  let best = null;
  for (const { edge, other } of neighborsOf(st, START_MOORING)) {
    const A = st.byId[START_MOORING], B = st.byId[other];
    for (const g of Object.keys(A.target)) {
      if (B.target[g] == null) continue;
      const buy = buyPrice(A, g), sell = sellPrice(B, g);
      if (!buy || !sell) continue;
      const margin = (sell - buy) * 20;
      if (!best || margin > best.margin) best = { g, other: B.name, buy, sell, margin };
    }
  }
  const offers = st.contracts.offers.length;
  const pass = best && best.margin > 60;
  if (pass) goodOpenings++; else weakOpenings++;
  console.log(`${seed.padEnd(9)} best-leg: ${best ? `${best.g} → ${best.other} @ ${best.buy}/${best.sell} = ${Math.round(best.margin)} g` : 'none'} · offers: ${offers} ${pass ? '✅' : '⚠️ weak'}`);

  // Actually play the best opening move and verify a real profitable round trip.
  if (best && best.margin > 0) {
    const before = st.player.credits;
    buyGood(st, best.g, 20);
    travelTo(st, best.other);
    let guard = 0;
    while (st.player.phase === 'travel' && guard++ < 100) {
      if (st.pendingEncounter) { st.pendingEncounter = null; st.paused = false; }
      tickOnce(st);
    }
    sellGood(st, best.g, 20);
    const gain = st.player.credits - before;
    console.log(`          round-trip played: ${Math.round(gain)} g net ${gain > 0 ? '✅' : '❌ LOSING'}`);
  }
}
console.log(`\nOpenings: ${goodOpenings} strong, ${weakOpenings} weak across ${SEEDS.length} seeds`);

// War pacing over 60 in-game days on one seed at 4x-ish coarse speed.
const st = generateWorld('pacing');
refreshOffers(st);
let firstWar = null;
for (let i = 0; i < 24 * 60; i++) {
  tickOnce(st, { coarse: true });
  if (st.wars.length && !firstWar) firstWar = { day: Math.floor(st.t / 24) + 1, ...st.wars[0] };
}
console.log(`\nWar pacing: first war ${firstWar ? `day ${firstWar.day} (${firstWar.a} vs ${firstWar.b})` : 'none in 60 days ⚠️'}`);
console.log(`End state day ${Math.floor(st.t / 24) + 1}: wars=${st.wars.length} treaties=${st.treaties.length} log events=${st.log.length}`);
