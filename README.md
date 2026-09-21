# 🔥 EMBERWAKE
### Skyship Ledger of the Shattered Reach

**A living-world skyship trading sim for the browser.** One ship. Five factions. A real
economy where every crate matters — and a storm-wall slowly rewriting the map.

You are an independent skyship captain in a shattered world of cloud-anchored moorings.
Buy where goods are plentiful, sail, sell where they are scarce. Run blockades, chart
anomalies, earn the trust of five rival factions, and survive long enough to found a
**Trade Dynasty**. No chosen one. Just supply, demand, fuel, and reputation.

---

## Why this game is different

- **The economy is physical.** Every mooring produces and consumes real goods; prices are
  a function of live stock vs. demand. NPC caravans physically haul cargo along lanes when
  margins justify it — and pay taxes that fund faction wars.
- **Everything ripples.** A war starves lanes of traffic → shortages spike → contracts
  flood the boards → blockade runners earn fortunes and enemies → treasuries bleed →
  treaties → reconstruction booms. You can be on any side of every link.
- **The map fights back.** Every 30 days a *Shroud tide* re-rolls which lanes are stormed.
  Route planning, fuel economics and risk appetite are the actual skill ceiling.
- **Reputation is the progression tree.** Contracts, licenses, restricted goods
  (armaments, relics), and ultimately the dynasty all hang off how five factions feel
  about you — and they feel things because of what *you* shipped.
- **Seeded, replayable worlds.** Every world is a seed: new geography, names, grudges,
  shortages. Prestige carries your achievements and artifact archive into a new Era.

## Play it

```bash
node server.js        # http://localhost:8080  (zero dependencies)
```

Or serve `public/` with any static server. No build step. No binaries. All art is
procedural (canvas + CSS + SVG), all audio is WebAudio-synthesized.

**Controls:** click moorings to travel · right-hand tabs for Market / Ship / Contracts /
Factions / Codex / Log · ⏸/1×/2×/4× own time (Space pauses, 1/2/3 switch speed) ·
wheel or ⌂/+/− to zoom · drag to pan.

## Run the tests

```bash
npm test                         # sim suite: gen, 1000-tick stability, determinism, saves
node test/browser.test.mjs       # headless browser smoke test (jsdom): boots the real game,
                                 # plays intro → buy → travel → sell → all tabs → save
node test/balance.probe.mjs      # economy probe: opening margins & war pacing across seeds
```

## The systems (all real, all wired)

| System | What it does |
|---|---|
| Economy | 10 goods · per-mooring production/consumption · price = f(stock/target) · market impact · faction fees |
| NPC traffic | Abstract caravans arbitrage gaps, pay taxes, fear storms and wars |
| Politics | Relations matrix, provocations, wars, treasuries, treaties, riots, booms |
| The Shroud | 30-day storm tides re-roll lane danger; anomalies surface in their wake |
| Travel | Fuel-burning legs, multi-hop routing (Dijkstra), 6 encounter archetypes with stat checks |
| Contracts | Deliveries / couriers / passengers / blockade runs / relief — generated from live world state |
| Reputation | −100…+100 per faction, six tiers, gates licenses and prices |
| Ship | 5 upgrade lines × 4 tiers, repairs, fuel tanks, scanner-gated market intel |
| Investments | Production shares with live dividends — each share expands local supply (+2%), so capital allocation can undercut your own routes |
| Crew | Generated officers, 6 trait archetypes that change travel/trade/combat math; daily wages, desertion when unpaid |
| Rivals | Three named NPC captains compounding worth in the same world (war profiteers earn ×1.5) on a live leaderboard |
| Discovery | Fog of memory, anomalies, 14 lore-bearing artifacts, codex, 16 achievements |
| Progression | 7-step milestone onboarding → licenses → crew & shares → wars → 200k dynasty → prestige Eras |

## Architecture

```
server.js                  dependency-free static server (future sync API home)
public/
  index.html               app shell
  css/style.css            the whole visual language ("aetherpunk cartography")
  js/
    core/                  rng, event bus, save schema — DOM-free
    data/                  goods, factions, names, artifacts — pure tables
    world/gen.js           seeded world generation (34 moorings, 40 lanes, 5 factions)
    sim/                   tick engine, economy math, contracts, encounters, progress
    player/actions.js      every player verb (validated, logged, event-emitting)
    audio/audio.js         procedural WebAudio (zero assets)
    ui/                    canvas map + DOM panels + overlays
    main.js                boot, loop, wiring
test/                      sim tests · jsdom browser smoke test · balance probe
```

Design rules that kept it coherent: **state is one plain JSON object** (versioned,
autosaved, offline catch-up ≤96h); **the sim never touches the DOM** (Node-testable,
server-portable); **the UI never mutates state** (all verbs go through `player/actions`);
**no fake buttons** — if it renders, it works.

## Roadmap

- **v1.1 ✅ shipped** — production shares (invest → dividends → reshape supply),
  crew officers with traits, rival captains leaderboard.
- **v1.3 ✅ shipped** — floating-island map art, drawn airship, clouds & storm fog,
  insurance underwriting, Syndicate dens (no-license contraband), crew veterans (★),
  squall fronts, seasonal risk, rival & Choir encounters, market filters.
- **v1.2 ✅ shipped** — the aliveness pass: floating numbers, map event pulses,
  world ticker, **Today's Reach** (daily shared seed — everyone playing today gets the
  same world), Shroud forecasts, procedural music, codex lore fragments, hotkeys,
  pinch-zoom, autosave indicator.
- **v1.3** — async layer on shared seeds: per-date leaderboards & ghost captains
  (your influence appears in other players' Today's Reach), weekly Shroud events.
- **v2.0** — dynasty heirs & succession crises, co-op convoy expeditions, warehouse
  ownership, faction HQ interiors.

## Business model (designed, not bolted on)

Cosmetics-and-convenience only — the economy's integrity *is* the product:
one-time **Founder's Ledger** (trails, nameplates, codex art), seasonal cosmetic themes,
optional **Chartwright** subscription for cloud saves + cross-device + ghost leaderboards.
No pay-to-win, no energy timers, no dark patterns.

---

*The Reach keeps turning while you plan. Contracts expire, wars start, harvests boom.*
*The ledger remembers.*
