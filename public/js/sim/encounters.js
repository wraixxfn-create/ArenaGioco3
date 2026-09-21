// Travel encounters. Each is a small authored scene with stat-checked choices;
// spawn odds are driven by the world (edge risk, storms, wars, scanner tier).

import { bus } from '../core/bus.js';
import { clamp, hashStr, mulberry32, rngInt, rngPick, rngChance, pickWeighted } from '../core/util.js';
import { GOODS, GOOD_ORDER } from '../data/goods.js';
import { FACTION_MAP } from '../data/factions.js';
import { mooringById } from '../world/gen.js';
import { isStormed, warOnEdge, scannerOf, tankCapOf, capacityOf, cargoCount } from './economy.js';

export function loseCargoFraction(state, frac) {
  const p = state.player;
  const lost = [];
  for (const [g, n] of Object.entries(p.cargo)) {
    const take = Math.min(n, Math.max(1, Math.round(n * frac)));
    if (take > 0) {
      p.cargo[g] = n - take;
      if (p.cargo[g] <= 0) delete p.cargo[g];
      lost.push({ good: g, n: take });
    }
  }
  return lost;
}

function addRep(state, faction, n) {
  state.player.rep[faction] = clamp((state.player.rep[faction] || 0) + n, -100, 100);
  bus.emit('rep', { faction, delta: n });
}

function lostText(lost) {
  if (!lost.length) return 'Your hold was already empty.';
  return `Lost: ${lost.map((l) => `${l.n} ${GOODS[l.good].name.toLowerCase()}`).join(', ')}.`;
}

function encRng(state) {
  return mulberry32((hashStr(state.meta.seed) ^ Math.imul(state.t * 31 + 17, 40503)) >>> 0);
}

// --- Individual encounters --------------------------------------------------

function encPirates(state, rng) {
  const p = state.player;
  return {
    icon: '☠️', title: 'Privateers on the lane',
    text: 'A rakish cutter drops from the cloud bank ahead, running no colors. A voice hails you: "Toll time, captain. The lane belongs to whoever is fastest."',
    choices: [
      {
        label: 'Pay the tribute', hint: 'Lose coin, keep cargo and hull.',
        resolve() {
          const cost = Math.min(Math.round(p.credits * 0.18) + 60, 320);
          p.credits = Math.max(0, p.credits - cost);
          return { text: `You slide a crate of coin across. The cutter peels away saluting, which feels worse than the ${cost} g.` };
        },
      },
      {
        label: 'Outrun them', hint: `Engine check · ${(Math.round((0.45 + 0.09 * p.ship.engine) * 100))}% to escape`,
        resolve() {
          if (rngChance(rng, 0.45 + 0.09 * p.ship.engine)) {
            return { text: 'Your engines scream; the cutter falls behind cursing. Nothing lost but fuel pressure.' };
          }
          const lost = loseCargoFraction(state, 0.15);
          return { text: `They clip your wake and board you briefly. ${lostText(lost)}` };
        },
      },
      {
        label: 'Fight', hint: `Hull check · ${(Math.round((0.35 + 0.09 * p.ship.hull) * 100))}% to win`,
        resolve() {
          if (rngChance(rng, 0.35 + 0.09 * p.ship.hull)) {
            const loot = rngInt(rng, 120, 320);
            p.credits += loot;
            addRep(state, 'union', 2);
            return { text: `Your plating holds and theirs doesn't. You salvage ${loot} g from the wreck. The Union approves (+2).` };
          }
          const dmg = rngInt(rng, 18, 30);
          p.hull = Math.max(0, p.hull - dmg);
          const lost = loseCargoFraction(state, 0.08);
          return { text: `They rake your hull (${dmg} damage) before breaking off. ${lostText(lost)}` };
        },
      },
    ],
  };
}

function encCustoms(state, rng) {
  const p = state.player;
  const dest = mooringById(state, p.travel?.to || p.mooring);
  const fac = FACTION_MAP[dest.faction];
  const contraband = Object.entries(p.cargo).filter(([g]) => GOODS[g].restricted && !p.licenses[dest.faction]);
  const hasContraband = contraband.length > 0;

  if (!hasContraband) {
    return {
      icon: '📜', title: `${fac.short} customs patrol`,
      text: `A ${fac.name} patrol boat slides alongside and requests a manifest check. Your paperwork is in order — mostly.`,
      choices: [
        {
          label: 'Comply graciously', hint: `+1 ${fac.short} reputation`,
          resolve() { addRep(state, dest.faction, 1); return { text: 'The inspector nods at your tidy ledger. "Credit to the lane," he mutters, stamping you through.' }; },
        },
        {
          label: 'Protest the delay', hint: 'Small chance of offending them',
          resolve() {
            if (rngChance(rng, 0.15)) { addRep(state, dest.faction, -1); return { text: 'The inspector takes the tone personally. You are logged. (−1 rep)' }; }
            return { text: 'You trade complaints with the inspector until you both get bored. Waved through.' };
          },
        },
      ],
    };
  }

  const value = contraband.reduce((s, [g, n]) => s + n * GOODS[g].base, 0);
  const bribe = Math.round(value * 0.35) + 50;
  return {
    icon: '📜', title: 'Customs patrol — contraband aboard',
    text: `A ${fac.name} patrol requests a hold inspection. You are carrying ${contraband.map(([g, n]) => `${n} ${GOODS[g].name.toLowerCase()}`).join(', ')} without a ${fac.short} license.`,
    choices: [
      {
        label: `Bribe the inspector (${bribe} g)`, hint: p.credits >= bribe ? 'Quiet and clean.' : 'You cannot afford this.',
        resolve() {
          if (p.credits < bribe) {
            const lost = loseCargoFraction(state, 0.3);
            return { text: `Your purse talks you into a corner. They take what they want. ${lostText(lost)}` };
          }
          p.credits -= bribe;
          return { text: 'The inspector admires the view from your starboard rail, where a small purse has appeared. Waved through.' };
        },
      },
      {
        label: 'Bluff the inspection', hint: '50% they look the other way',
        resolve() {
          if (rngChance(rng, 0.5)) {
            return { text: 'They poke at the water barrels, shrug, and leave. Your heart takes longer to slow down.' };
          }
          for (const [g] of contraband) delete p.cargo[g];
          addRep(state, dest.faction, -5);
          return { text: `Confiscated, stamped, and logged. ${fac.short} reputation −5.` };
        },
      },
    ],
  };
}

function encCache(state, rng) {
  const p = state.player;
  const good = rngPick(rng, GOOD_ORDER.filter((g) => GOODS[g].tier <= 1));
  const qty = rngInt(rng, 4, 10);
  return {
    icon: '🪝', title: 'Drifting cargo net',
    text: `A severed cargo net tumbles slowly through the clouds, heavy with ${GOODS[good].name.toLowerCase()}. Someone above had a bad day; the sky provides.`,
    choices: [
      {
        label: 'Haul it aboard', hint: `${qty} ${GOODS[good].name.toLowerCase()} — if you have space`,
        resolve() {
          const space = capacityOf(state) - cargoCount(p);
          const take = Math.max(0, Math.min(qty, space));
          if (take > 0) p.cargo[good] = (p.cargo[good] || 0) + take;
          if (take < qty) {
            const refund = (qty - take) * Math.round(GOODS[good].base * 0.5);
            p.credits += refund;
            return { text: `You stow ${take} crates; the rest you fence to a passing lighter for ${refund} g.` };
          }
          return { text: `${take} crates of ${GOODS[good].name.toLowerCase()} added to the hold. Free is a wonderful purchase price.` };
        },
      },
      {
        label: 'Leave it', hint: 'Not worth the time',
        resolve() { return { text: 'You mark it on the lane chart for someone hungrier and sail on.' }; },
      },
    ],
  };
}

function encDistress(state, rng) {
  const p = state.player;
  const fac = rngPick(rng, ['concord', 'verdant', 'choir', 'union', 'syndicate']);
  return {
    icon: '🆘', title: 'Distress beacon',
    text: `A skiff drifts dead in the clouds, beacon blinking. Its flag is ${FACTION_MAP[fac].name} — torn, but legible.`,
    choices: [
      {
        label: 'Stop and help', hint: '−2 fuel, +2h delay, reputation reward',
        resolve() {
          if (p.fuel >= 2) p.fuel -= 2;
          if (p.travel) p.travel.dur += 2;
          addRep(state, fac, 3);
          if (rngChance(rng, 0.5)) {
            const c = rngInt(rng, 100, 300);
            p.credits += c;
            return { text: `You tow them to a shipping lane. The crew transfers ${c} g and a promise. ${FACTION_MAP[fac].short} reputation +3.` };
          }
          return { text: `You tow them clear. No coin changes hands, but the ${FACTION_MAP[fac].short} remember (+3).` };
        },
      },
      {
        label: 'Salvage the wreck', hint: 'Risky money; the Choir disapproves',
        resolve() {
          addRep(state, 'choir', -2);
          if (rngChance(rng, 0.5)) {
            const c = rngInt(rng, 150, 400);
            p.credits += c;
            return { text: `You strip the skiff for ${c} g of parts. The beacon keeps blinking after you leave. Choir reputation −2.` };
          }
          return { text: 'The skiff is picked clean already — by something. Choir reputation −2 for the attempt.' };
        },
      },
      {
        label: 'Pass by', hint: 'The lane is no place for sentiment',
        resolve() { return { text: 'You log the beacon position for the next patrol and keep your course.' }; },
      },
    ],
  };
}

function encTailwind(state, rng) {
  void rng;
  const p = state.player;
  return {
    icon: '💨', title: 'Ember-stream',
    text: 'A river of warm updraft crosses the lane — embers glittering in it like fish. Any sane captain rides it.',
    choices: [
      {
        label: 'Ride the stream', hint: 'Shaves hours off this leg',
        resolve() {
          if (p.travel) {
            const cut = Math.max(1, Math.round((p.travel.dur - p.travel.t) * 0.25));
            p.travel.dur = Math.max(p.travel.t + 1, p.travel.dur - cut);
          }
          return { text: 'The ship leans into the warmth and surges. You will arrive sooner than the chart promised.' };
        },
      },
    ],
  };
}

function encWisp(state, rng) {
  const p = state.player;
  return {
    icon: '🌫️', title: 'Shroud wisps',
    text: 'Tendrils of the Shroud drift across the lane ahead — thin here, but alive. Wisps sometimes carry things out of the storm. Sometimes they take things in.',
    choices: [
      {
        label: 'Sift the wisps', hint: 'May yield embers. May bite.',
        resolve() {
          const r = rng();
          if (r < 0.4) {
            const gain = Math.min(rngInt(rng, 6, 12), tankCapOf(state) - p.fuel);
            p.fuel = Math.round((p.fuel + Math.max(0, gain)) * 10) / 10;
            return { text: `The wisps part around a knot of unburnt embers. +${gain} fuel, gift of the storm.` };
          }
          if (r < 0.8) return { text: 'Nothing but cold mist and the feeling of being counted. You sail on.' };
          const dmg = rngInt(rng, 6, 12);
          p.hull = Math.max(0, p.hull - dmg);
          return { text: `Something in the mist leans on the hull like a hand testing fruit. ${dmg} damage before it loses interest.` };
        },
      },
      {
        label: 'Give them a wide berth', hint: 'Slow, safe, sane',
        resolve() { return { text: 'You skirt the wisps at a respectful distance. The storm appreciates manners, allegedly.' }; },
      },
    ],
  };
}

// --- Dispatcher ----------------------------------------------------------------

const ENCOUNTER_DEFS = [
  ['pirates', encPirates, 28],
  ['customs', encCustoms, 20],
  ['cache', encCache, 14],
  ['distress', encDistress, 14],
  ['tailwind', encTailwind, 12],
  ['wisp', encWisp, 12],
];

export function maybeEncounter(state, edge) {
  const rng = encRng(state);
  const p = state.player;
  let prob = (edge.baseRisk / 100)
    * (isStormed(state, edge) ? 2 : 1)
    * (warOnEdge(state, edge) ? 1.8 : 1)
    * (1 - 0.08 * scannerOf(state));
  prob = clamp(prob, 0, 0.55);
  if (!rngChance(rng, prob)) return null;
  const [, fn] = pickWeighted(rng, ENCOUNTER_DEFS.map(([k, f, w]) => [[k, f], w]));
  return fn(state, rng);
}
