// World generation: seeded, deterministic, fully data-driven.
// Regions → moorings → edges → economies → factions → anomalies → player.

import { hashStr, mulberry32, rngInt, rngPick, rngChance, shuffle, dist } from '../core/util.js';
import { GOODS, GOOD_ORDER } from '../data/goods.js';
import { FACTIONS, FACTION_MAP, BASE_RELATIONS, relKey } from '../data/factions.js';
import { genMooringName, genOfficerName, OFFICER_TRAITS, RIVAL_NAME_POOL } from '../data/names.js';

export const WORLD_W = 1200;
export const WORLD_H = 820;
export const START_MOORING = 'lanterns-rest';

// [id?, x, y, region, faction] — hand-placed skeletons, procedural dressing.
const REGION_DEFS = [
  { name: 'Ashen Veil', faction: 'syndicate', pts: [[110, 145], [210, 92], [172, 255], [66, 305]] },
  { name: 'Brass Range', faction: 'concord', pts: [[935, 95], [1052, 152], [862, 178], [1012, 258], [1122, 82]] },
  { name: 'Verdant Steps', faction: 'verdant', pts: [[142, 425], [242, 472], [108, 532], [272, 578], [188, 645]] },
  { name: 'The Tides', faction: 'choir', pts: [[1012, 424], [928, 488], [1088, 532], [988, 604], [1122, 648]] },
  { name: 'Lantern Straits', faction: 'union', pts: [[472, 302], [592, 256], [642, 392], [528, 478], [408, 378], [702, 318]] },
  { name: 'Shroud March', mixed: ['verdant', 'syndicate', 'union', 'choir'], pts: [[332, 692], [458, 706], [566, 668], [392, 762]] },
  { name: 'Cinder Wastes', mixed: ['syndicate', 'concord', 'union', 'syndicate', 'concord'], pts: [[732, 692], [858, 722], [682, 762], [962, 748], [1082, 716]] },
];

const HQ_NAMES = {
  concord: 'Kilnspire', verdant: 'Asterfield', choir: 'Deepwell', union: 'Windward Gate', syndicate: 'Ashen Citadel',
};

const EDGES_DEF = [
  ['r0m0', 'r0m1'], ['r0m0', 'r0m2'], ['r0m1', 'r4m0'], ['r0m2', 'r4m4'], ['r0m3', 'r0m2'], ['r0m3', 'r2m0'],
  ['r1m0', 'r1m2'], ['r1m0', 'r1m4'], ['r1m1', 'r1m3'], ['r1m2', 'r1m3'], ['r1m2', 'r4m5'], ['r1m3', 'r3m0'],
  ['r2m0', 'r2m1'], ['r2m1', 'r2m3'], ['r2m1', 'r5m0'], ['r2m2', 'r2m0'], ['r2m3', 'r2m4'], ['r2m4', 'r5m3'],
  ['r3m0', 'r3m1'], ['r3m0', 'r4m5'], ['r3m1', 'r3m2'], ['r3m2', 'r3m4'], ['r3m2', 'r5m1'], ['r3m3', 'r3m1'],
  ['r4m0', 'r4m4'], ['r4m0', 'r4m2'], ['r4m1', 'r4m5'], ['r4m1', 'r4m2'], ['r4m2', 'r4m3'], ['r4m3', 'r4m4'], ['r4m3', 'r5m2'],
  ['r5m0', 'r5m3'], ['r5m1', 'r6m2'], ['r5m2', 'r6m0'], ['r5m2', 'r6m2'],
  ['r6m0', 'r6m2'], ['r6m0', 'r6m1'], ['r6m1', 'r6m3'], ['r6m3', 'r6m4'], ['r6m3', 'r3m3'],
];

function mooringId(regionIdx, i) { return `r${regionIdx}m${i}`; }

function makeProd(rng, faction) {
  const f = FACTION_MAP[faction];
  const main = rngPick(rng, f.exports);
  const prod = { [main]: rngInt(rng, 55, 165) };
  if (rngChance(rng, 0.35)) {
    const second = rngPick(rng, GOOD_ORDER.filter((g) => g !== main && GOODS[g].tier <= 1));
    prod[second] = rngInt(rng, 25, 70);
  }
  return prod;
}

function dailyConsumption(m) {
  const pop = m.pop;
  const cons = {
    water: pop * 0.05,
    grain: pop * 0.06,
    spice: pop * 0.008,
    medicine: pop * 0.006,
    textiles: pop * 0.012,
    embers: pop * 0.012,
  };
  if (m.faction === 'concord') { cons.ore = pop * 0.03; cons.alloys = pop * 0.008; }
  if (m.hq) cons.armaments = 6; // garrisons eat steel
  return cons;
}

export function computeTargets(m) {
  const targets = {};
  const cons = dailyConsumption(m);
  for (const g of GOOD_ORDER) {
    const prodRate = m.prod[g] || 0;
    const consRate = cons[g] || 0;
    if (prodRate <= 0 && consRate <= 0) continue;
    targets[g] = Math.max(prodRate * 4, consRate * 6, 40);
  }
  m.target = targets;
  m.cons = cons;
  return targets;
}

export function generateWorld(seedStr, meta = {}) {
  const seed = typeof seedStr === 'string' ? hashStr(seedStr) : seedStr >>> 0;
  const rng = mulberry32(seed);
  const usedNames = new Set();

  // --- Moorings -------------------------------------------------------
  const moorings = [];
  REGION_DEFS.forEach((region, ri) => {
    region.pts.forEach((pt, i) => {
      const id = mooringId(ri, i);
      const faction = region.mixed ? region.mixed[i] : region.faction;
      const isHq = i === 0 && !region.mixed;
      const isStart = id === 'r4m0';
      const pop = isHq ? rngInt(rng, 620, 860) : isStart ? 720 : rngInt(rng, 120, 640);
      const m = {
        id, region: region.name, faction, x: pt[0], y: pt[1], pop,
        hq: isHq ? faction : null,
        prod: {},
        shipyard: isHq || isStart,
        visited: isStart,
        stability: rngInt(rng, 55, 78),
        news: '',
        blurb: '',
      };
      moorings.push(m);
    });
  });

  const byId = Object.fromEntries(moorings.map((m) => [m.id, m]));

  // Assign names (fixed for HQs/start, generated otherwise).
  const startM = byId['r4m0'];
  startM.id = START_MOORING;
  delete byId['r4m0'];
  byId[START_MOORING] = startM;
  startM.name = 'Lantern\u2019s Rest';
  startM.blurb = 'A neutral harbor hung with a thousand lanterns. Everyone trades here; nobody owns it.';
  usedNames.add(startM.name);
  for (const m of moorings) {
    if (m === startM) continue;
    if (m.hq) { m.name = HQ_NAMES[m.hq]; usedNames.add(m.name); continue; }
    m.name = genMooringName(rng, usedNames);
  }

  // Production: faction-flavored, with global coverage guarantees.
  for (const m of moorings) {
    if (rngChance(rng, 0.82) || m.hq) m.prod = makeProd(rng, m.faction);
  }
  for (const g of GOOD_ORDER) {
    if (g === 'relics' || g === 'armaments') continue; // specialty goods: sparse on purpose
    let producers = moorings.filter((m) => (m.prod[g] || 0) > 0).length;
    while (producers < 5) {
      const m = rngPick(rng, moorings.filter((x) => !(x.prod[g] > 0)));
      if (!m) break;
      m.prod[g] = rngInt(rng, 40, 120);
      producers++;
    }
  }
  // Specialty: a couple of relic camps and armament forges.
  const relicCamps = shuffle(rng, moorings.filter((m) => m.faction === 'syndicate' && !m.hq)).slice(0, 2);
  relicCamps.forEach((m) => { m.prod.relics = rngInt(rng, 4, 9); });
  const forges = shuffle(rng, moorings.filter((m) => (m.faction === 'syndicate' || m.faction === 'concord') && !m.hq)).slice(0, 2);
  forges.forEach((m) => { m.prod.armaments = rngInt(rng, 6, 14); });

  for (const m of moorings) computeTargets(m);

  // Initial stocks: mostly healthy, a few seeded shortages for early drama.
  for (const m of moorings) {
    m.stock = {};
    for (const g of Object.keys(m.target)) {
      let ratio = 0.6 + rng() * 0.7;
      if (rngChance(rng, 0.12)) ratio = 0.15 + rng() * 0.2; // scarcity pocket
      m.stock[g] = Math.round(m.target[g] * ratio);
    }
  }

  // --- Edges -----------------------------------------------------------
  const fixId = (id) => (id === 'r4m0' ? START_MOORING : id); // start mooring was renamed above
  const edges = EDGES_DEF.map(([rawA, rawB], i) => {
    const a = fixId(rawA), b = fixId(rawB);
    const len = Math.round(dist(byId[a].x, byId[a].y, byId[b].x, byId[b].y) / 26 * 10) / 10;
    return {
      id: `e${i}`, a, b,
      len: Math.max(4, Math.min(16, len)), // travel hours at 1x hull speed
      baseRisk: rngInt(rng, 2, 6),          // % encounter chance per leg
      stormUntil: 0,
    };
  });

  // --- Factions & politics ----------------------------------------------
  const factions = FACTIONS.map((f) => ({
    id: f.id, treasury: rngInt(rng, 9000, 16000), aggression: f.aggression,
    atWarSince: 0, tradeVolume: 0, lastTribute: -999,
  }));
  const relations = {};
  const pairs = [];
  for (let i = 0; i < FACTIONS.length; i++) {
    for (let j = i + 1; j < FACTIONS.length; j++) pairs.push([FACTIONS[i].id, FACTIONS[j].id]);
  }
  for (const [a, b] of pairs) {
    const k = relKey(a, b);
    const base = BASE_RELATIONS[k] !== undefined ? BASE_RELATIONS[k] : rngInt(rng, -8, 18);
    relations[k] = Math.round(base + (rng() * 16 - 8));
  }

  // --- Anomalies ----------------------------------------------------------
  const anomalies = [];
  const candidates = shuffle(rng, moorings.filter((m) => m.id !== START_MOORING && !m.hq)).slice(0, 3);
  candidates.forEach((m, i) => {
    const ang = rng() * Math.PI * 2;
    const r = 70 + rng() * 60;
    anomalies.push({
      id: `anom-${i}`, nearMooring: m.id,
      x: Math.max(20, Math.min(WORLD_W - 20, m.x + Math.cos(ang) * r)),
      y: Math.max(20, Math.min(WORLD_H - 20, m.y + Math.sin(ang) * r)),
      kind: rngPick(rng, ['derelict', 'derelict', 'cache', 'beacon']),
      scanLeft: -1, salvaged: false,
    });
  });

  // --- Extra shipyards: 3 busy non-HQ moorings -----------------------------
  const yardCandidates = shuffle(rng, moorings.filter((m) => !m.shipyard && m.pop > 380)).slice(0, 3);
  yardCandidates.forEach((m) => { m.shipyard = true; });

  // --- Officer pools at every shipyard & faction seat -----------------------
  const traitIds = Object.keys(OFFICER_TRAITS);
  for (const m of moorings) {
    if (!m.shipyard && !m.hq) continue;
    m.crewPool = [0, 1].map((i) => ({
      id: `crew-${m.id}-${i}`,
      name: genOfficerName(rng),
      trait: traitIds[Math.floor(rng() * traitIds.length)],
      wage: rngInt(rng, 18, 55),
    }));
  }

  // --- Rival captains: named NPC competitors living in the same world -------
  const rivalNames = shuffle(rng, RIVAL_NAME_POOL).slice(0, 3);
  const rivals = rivalNames.map((name, i) => ({
    id: `rival-${i}`,
    name,
    faction: FACTIONS[Math.floor(rng() * FACTIONS.length)].id,
    worth: rngInt(rng, 3000, 9000),
    aggression: 0.35 + rng() * 0.55,
  }));

  // --- Player -------------------------------------------------------------
  const player = {
    mooring: START_MOORING,
    phase: 'dock',
    travel: null,
    credits: 1200,
    fuel: 30,
    hull: 100,
    cargo: {},
    passengers: [],
    ship: { cargo: 0, engine: 0, tank: 0, hull: 0, scanner: 0 },
    licenses: {},
    rep: Object.fromEntries(FACTIONS.map((f) => [f.id, 0])),
    stats: {
      trades: 0, profit: 0, profitWar: 0, legs: 0, docks: 0, delivered: 0, failed: 0,
      blockades: 0, visited: [START_MOORING], artifacts: 0, scanned: 0, storms: 0,
      earnedTotal: 0, spentTotal: 0, repBest: 0, dividends: 0, sharesBought: 0,
      smuggled: 0,
    },
    flags: { tutorialBuy: false, tutorialSell: false, tutorialContract: false },
    crew: [],
    investments: {}, // mooringId -> { good, shares }
    insurance: false,
  };

  const state = {
    v: 3,
    meta: { seed: String(seedStr), era: meta.era || 1, createdAt: Date.now(), legacyBonus: meta.legacyBonus || 0, archive: meta.archive || [] },
    t: 8, // Day 1, 08:00 — a civilized hour to found a dynasty.
    paused: false,
    speed: 1,
    moorings, byId, edges, factions, relations,
    wars: [],
    treaties: [],
    caravans: [],
    anomalies,
    player,
    rivals,
    contracts: { offers: [], active: [], history: [], nextRefresh: 20 },
    fleet: [],
    log: [],
    artifacts: {},
    achievements: {},
    milestones: { idx: 0, done: {} },
    settings: { audio: true, ambient: true, vol: 0.5, hints: true },
    ui: { tab: 'market', selected: START_MOORING },
    offlineReport: null,
  };

  state.byId = Object.fromEntries(moorings.map((m) => [m.id, m]));
  return state;
}

// --- Query helpers (used everywhere) -------------------------------------

export function mooringById(state, id) { return state.byId[id]; }

export function edgesOf(state, mooringId) {
  return state.edges.filter((e) => e.a === mooringId || e.b === mooringId);
}

export function neighborsOf(state, mooringId) {
  const out = [];
  for (const e of edgesOf(state, mooringId)) {
    out.push({ edge: e, other: e.a === mooringId ? e.b : e.a });
  }
  return out;
}

export function edgeBetween(state, a, b) {
  return state.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

export function factionOf(state, mooring) {
  return FACTION_MAP[mooring.faction];
}

export function ownedBy(state, factionId) {
  return state.moorings.filter((m) => m.faction === factionId);
}
