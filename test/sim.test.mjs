// Sim smoke test — runs in Node, no DOM. Verifies world gen, economy,
// politics, contracts, travel, and save-data serializability.

import { generateWorld, START_MOORING } from '../public/js/world/gen.js';
import { tickOnce, runOffline } from '../public/js/sim/sim.js';
import { priceOf, buyPrice, sellPrice, findRoute, netWorth, capacityOf } from '../public/js/sim/economy.js';
import { buyGood, sellGood, travelTo, acceptContract, deliverContract, refuel, buyShare, hireCrew, dismissCrew, buyInsurance } from '../public/js/player/actions.js';
import { refreshOffers } from '../public/js/sim/contracts.js';
import { checkMilestones, checkAchievements } from '../public/js/sim/progress.js';
import { GOOD_ORDER, GOODS as GOODS_MAP } from '../public/js/data/goods.js';

let failures = 0;
const ok = (cond, msg) => {
  if (!cond) { failures++; console.error('  ✗ FAIL:', msg); }
};
const section = (s) => console.log(`\n== ${s}`);

// --- World gen -------------------------------------------------------------
section('world generation');
for (const seed of ['alpha', 'bravo', 'test-seed-99']) {
  const st = generateWorld(seed);
  ok(st.moorings.length === 34, `${seed}: 34 moorings (got ${st.moorings.length})`);
  ok(st.byId[START_MOORING], `${seed}: start mooring exists`);
  ok(Object.keys(st.relations).length === 10, `${seed}: 10 faction pairs`);
  ok(st.anomalies.length === 3, `${seed}: 3 anomalies`);
  ok(st.edges.length >= 38, `${seed}: enough edges (got ${st.edges.length})`);

  // Graph connectivity: route from start to every mooring.
  let unreachable = 0;
  for (const m of st.moorings) {
    if (m.id === START_MOORING) continue;
    if (!findRoute(st, START_MOORING, m.id)) unreachable++;
  }
  ok(unreachable === 0, `${seed}: all moorings reachable (${unreachable} unreachable)`);

  // Economy sanity.
  for (const m of st.moorings) {
    for (const g of Object.keys(m.target)) {
      const p = priceOf(m, g);
      ok(p != null && p > 0 && p < 500, `${seed}: sane price at ${m.id}/${g} (got ${p})`);
    }
  }
  // Every non-restricted good is produced somewhere.
  for (const g of GOOD_ORDER) {
    if (g === 'relics' || g === 'armaments') continue;
    const producers = st.moorings.filter((m) => (m.prod[g] || 0) > 0).length;
    ok(producers >= 5, `${seed}: ${g} has ${producers} producers`);
  }
}

// --- Long-run stability ------------------------------------------------------
section('1000-tick stability run');
const st = generateWorld('stability');
refreshOffers(st);
for (let i = 0; i < 1000; i++) tickOnce(st);
ok(Number.isFinite(st.player.credits), 'credits finite');
for (const m of st.moorings) {
  for (const g of Object.keys(m.stock)) {
    ok(Number.isFinite(m.stock[g]) && m.stock[g] >= 0, `stock finite/positive ${m.id}/${g} = ${m.stock[g]}`);
    const p = priceOf(m, g);
    ok(p > 0 && p < 600, `price bounded after 1000 ticks ${m.id}/${g} = ${p}`);
  }
  ok(Number.isFinite(m.stability), `stability finite ${m.id}`);
}
for (const f of st.factions) ok(Number.isFinite(f.treasury), `treasury finite ${f.id} = ${Math.round(f.treasury)}`);
ok(st.caravans.length <= 45, `caravan cap held (${st.caravans.length})`);
console.log(`  after 1000 ticks: wars=${st.wars.length}, treaties=${st.treaties.length}, caravans=${st.caravans.length}, log=${st.log.length}`);
ok(st.log.length > 5, 'world produced news');
ok(st.treaties.length + st.wars.length >= 1, 'politics happened within ~41 days');

// --- Player verbs -------------------------------------------------------------
section('player actions');
const s2 = generateWorld('verbs');
refreshOffers(s2);
const start = s2.byId[START_MOORING];
const tradeable = GOOD_ORDER.filter((g) => start.target[g] != null && buyPrice(start, g) != null);
ok(tradeable.length >= 4, `start market has goods (${tradeable.length})`);
const g0 = tradeable[0];
const res1 = buyGood(s2, g0, 10);
ok(res1.ok, `buy 10 ${g0}: ${res1.reason || 'ok'}`);
ok(s2.player.cargo[g0] === 10, 'cargo updated');
const cap = capacityOf(s2);
const resBig = buyGood(s2, g0, 500);
ok((s2.player.cargo[g0] || 0) <= cap, 'capacity respected on bulk buy');
void resBig;

// Travel to neighbor and sell.
const nb = s2.edges.find((e) => e.a === START_MOORING || e.b === START_MOORING);
const destId = nb.a === START_MOORING ? nb.b : nb.a;
const tv = travelTo(s2, destId);
ok(tv.ok, `travel ok: ${tv.reason || ''}`);
ok(s2.player.phase === 'travel', 'phase=travel');
let guard = 0;
while (s2.player.phase === 'travel' && guard++ < 200) {
  if (s2.pendingEncounter) { s2.pendingEncounter = null; s2.paused = false; }
  tickOnce(s2);
}
ok(s2.player.phase === 'dock' && s2.player.mooring === destId, `arrived at ${destId} (at ${s2.player.mooring})`);
const sellRes = sellGood(s2, g0, 10);
ok(sellRes.ok, `sell ok: ${sellRes.reason || ''}`);

// Refuel.
const rf = refuel(s2, 20);
ok(rf.ok || rf.reason, 'refuel returns result');

// Contracts: acceptance is location-bound. Chase the nearest offer like a real captain.
s2.player.fuel = 120; // test fixture: full tanks for the chase
let accepted = null;
for (let attempt = 0; attempt < 8 && !accepted; attempt++) {
  if (!s2.contracts.offers.length) refreshOffers(s2);
  let offer = s2.contracts.offers.find((o) => !o.from || o.from === s2.player.mooring);
  if (!offer && s2.contracts.offers.length) {
    offer = s2.contracts.offers.slice().sort((a, b) => {
      const ha = findRoute(s2, s2.player.mooring, a.from)?.hours ?? Infinity;
      const hb = findRoute(s2, s2.player.mooring, b.from)?.hours ?? Infinity;
      return ha - hb;
    })[0];
    const toFrom = travelTo(s2, offer.from);
    if (!toFrom.ok) { tickOnce(s2); continue; }
    let guard2 = 0;
    while (s2.player.phase === 'travel' && guard2++ < 600) {
      if (s2.pendingEncounter) { s2.pendingEncounter = null; s2.paused = false; }
      tickOnce(s2);
    }
    continue; // offers may have refreshed en route — re-pick
  }
  if (offer) {
    const acc = acceptContract(s2, offer.id);
    if (acc.ok) accepted = offer;
    else tickOnce(s2);
  } else {
    tickOnce(s2);
  }
}
ok(!!accepted, `a contract was accepted (${accepted?.kind || 'none'})`);

// --- Offline catch-up ---------------------------------------------------------
section('offline catch-up');
const s3 = generateWorld('offline');
refreshOffers(s3);
const t0 = s3.t;
runOffline(s3, 72);
ok(s3.t - t0 === 72, 'offline advanced 72h');
ok(s3.player.phase === 'dock', 'player untouched by offline sim');

// --- Milestones/achievements ---------------------------------------------------
section('progression');
const s4 = generateWorld('progress');
refreshOffers(s4);
checkMilestones(s4); checkAchievements(s4);
ok(Object.keys(s4.achievements).length === 0, 'no achievements before acting');
buyGood(s4, tradeable[0], 3);
checkMilestones(s4); checkAchievements(s4);
ok(s4.achievements['first_sale'], 'first_sale achievement earned after a trade');
ok(s4.milestones.idx >= 1, 'milestone 1 completed');

// --- v1.1: crew, shares, rivals -----------------------------------------------------
section('v1.1: crew, shares, rivals');
const s5 = generateWorld('v11');
refreshOffers(s5);
ok(s5.rivals.length === 3, '3 rival captains generated');
ok((s5.byId[START_MOORING].crewPool || []).length === 2, 'start mooring has an officer pool');

s5.player.credits = 50000;
const cand = s5.byId[START_MOORING].crewPool[0];
const hireRes = hireCrew(s5, cand.id);
ok(hireRes.ok, `hire officer: ${hireRes.reason || ''}`);
ok(s5.player.crew.length === 1, 'officer aboard');
ok(s5.byId[START_MOORING].crewPool.length === 1, 'candidate removed from pool');
ok(dismissCrew(s5, s5.player.crew[0].id).ok, 'dismiss works');
hireCrew(s5, s5.byId[START_MOORING].crewPool[0].id);

// Shares: must be docked, friendly, and solvent. (Skip contraband producers.)
const shareM = s5.moorings.find((m) => Object.entries(m.prod).some(([g, v]) => v >= 15 && !GOODS_MAP[g]?.restricted));
const shareGood = Object.entries(shareM.prod).find(([g, v]) => v >= 15 && !GOODS_MAP[g]?.restricted)[0];
s5.player.phase = 'dock';
s5.player.mooring = shareM.id;
const noRep = buyShare(s5, shareM.id, shareGood);
ok(!noRep.ok, 'share purchase blocked without Friendly rep');
s5.player.rep[shareM.faction] = 25;
const sh = buyShare(s5, shareM.id, shareGood);
ok(sh.ok, `buy share: ${sh.reason || ''}`);
ok(s5.player.investments[shareM.id].shares === 1, 'share recorded');

// Dawn: dividends pay, wages fall due, rivals grow.
const rivalBefore = s5.rivals[0].worth;
const t5 = s5.t;
for (let i = 0; i < 30 && Math.floor(s5.t / 24) === Math.floor(t5 / 24); i++) tickOnce(s5);
tickOnce(s5); // cross into the new day
ok(s5.player.stats.dividends > 0, `dividends paid (${s5.player.stats.dividends} g)`);
ok(s5.rivals[0].worth > rivalBefore, 'rival captains grew richer');

// --- v1.3: insurance, dens, crew veterans, squalls -------------------------------
section('v1.3: insurance, dens, veterans, squalls');
const s6 = generateWorld('v13');
refreshOffers(s6);
s6.player.credits = 20000;
const ins = buyInsurance(s6);
ok(ins.ok, `insurance at shipyard: ${ins.reason || ''}`);
const creditsBeforePremium = s6.player.credits;
let crossedDawn = false;
for (let i = 0; i < 26 && !crossedDawn; i++) {
  const d0 = Math.floor(s6.t / 24);
  tickOnce(s6);
  crossedDawn = Math.floor(s6.t / 24) > d0;
}
if (!crossedDawn) tickOnce(s6);
ok(s6.player.insurance === true, 'policy still active');
ok(s6.player.credits === creditsBeforePremium - 35, `premium deducted (${creditsBeforePremium} → ${s6.player.credits})`);

// Den sale: fence relics at a Syndicate mooring without a license.
const den = s6.moorings.find((m) => m.faction === 'syndicate');
s6.player.phase = 'dock';
s6.player.mooring = den.id;
s6.player.cargo.relics = 4;
const denSale = sellGood(s6, 'relics', 4);
ok(denSale.ok, `den sale without license: ${denSale.reason || ''}`);
ok(s6.player.stats.smuggled === 4, `smuggled stat (${s6.player.stats.smuggled})`);
const notDen = s6.moorings.find((m) => m.faction !== 'syndicate' && m.target.relics != null);
if (notDen) {
  s6.player.mooring = notDen.id;
  s6.player.cargo.relics = 2;
  const blocked = sellGood(s6, 'relics', 2);
  ok(!blocked.ok, 'relics still blocked outside dens without license');
}

// Crew veterans: 20 legs at sea earns the star.
const s7 = generateWorld('vet');
s7.player.credits = 20000;
hireCrew(s7, s7.byId[START_MOORING].crewPool[0].id);
const officer = s7.player.crew[0];
ok(officer.legs === 0 && !officer.star, 'officer starts green');
const nb7 = s7.edges.find((e) => e.a === START_MOORING || e.b === START_MOORING);
const dest7 = nb7.a === START_MOORING ? nb7.b : nb7.a;
for (let leg = 0; leg < 20 && !officer.star; leg++) {
  s7.player.fuel = 80; // test fixture: keep the shuttle flying
  travelTo(s7, leg % 2 === 0 ? dest7 : START_MOORING);
  let guard = 0;
  while (s7.player.phase === 'travel' && guard++ < 120) {
    if (s7.pendingEncounter) { s7.pendingEncounter = null; s7.paused = false; }
    tickOnce(s7);
  }
}
ok(officer.star === true, `officer earned veteran star (legs=${officer.legs})`);

// Squalls show up over a month of coarse sim.
const s8 = generateWorld('squalls');
refreshOffers(s8);
for (let i = 0; i < 24 * 30; i++) tickOnce(s8, { coarse: true });
const squalls = s8.log.filter((l) => l.text.includes('squall')).length;
ok(squalls >= 1, `squall fronts occurred (${squalls} in 30 days)`);

// --- Serializability -------------------------------------------------------------
section('save round-trip');
const json = JSON.stringify(s2, (k, v) => (k.startsWith('_') ? undefined : v));
const parsed = JSON.parse(json);
ok(parsed.moorings.length === 34, 'state survives JSON round-trip');
ok(typeof netWorth === 'function', 'netWorth exported');
ok(netWorth(s2) > 0, `net worth positive (${netWorth(s2)})`);

// Determinism check: same seed, same ticks → same prices.
section('determinism');
const da = generateWorld('det'); const db = generateWorld('det');
for (let i = 0; i < 50; i++) { tickOnce(da); tickOnce(db); }
const ma = da.byId[START_MOORING], mb = db.byId[START_MOORING];
ok(JSON.stringify(ma.stock) === JSON.stringify(mb.stock), 'identical seeds diverge nowhere (stocks)');
ok(JSON.stringify(da.caravans.length) === JSON.stringify(db.caravans.length), 'caravan counts match');

console.log(failures === 0 ? '\n✅ ALL TESTS PASSED' : `\n❌ ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
