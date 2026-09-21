# EMBERWAKE — Design Document

> A living-world skyship trading sim. One ship. Five factions. A real economy where every crate matters.

**Version 1.0 · "First Tide" · single-player, persistent, seeded worlds**

---

## 1. Elevator pitch

You are an independent skyship captain in the Shattered Reach — a sea of cloud dotted with
anchored moorings, ruled by five rival factions and slowly swallowed by a storm-wall called
**the Shroud**. There is no chosen one. There is supply, demand, fuel, and reputation.

Buy grain where the harvest broke. Sell it where the granaries burned. Run armaments past a
blockade for the side that pays better. Chart the anomalies the Shroud leaves behind. Survive
long enough and the factions stop being your landlords and start being your clients — and then
your heirs found a **Trade Dynasty**.

The fantasy: *the world is a machine, and I learned to drive it.*

## 2. What this is NOT

- Not an idle/clicker. Time passes, but every gain requires a decision.
- Not a menu simulator. The map is the game; panels are instruments.
- Not 30 disconnected features. ~8 systems, densely wired together.
- No fake buttons. If it's in the UI, it works.

## 3. Core loop

```
          ┌─────────────────────────────────────────────┐
          │  SCAN the market → CHOOSE a route (fuel,    │
          │  storms, war risk) → TRAVEL (encounters) →  │
          │  TRADE / DELIVER → REPUTATION & CAPITAL →   │
          │  UPGRADE ship / buy LICENSES → reach farther│
          │  markets & rarer contracts → repeat, bigger │
          └─────────────────────────────────────────────┘
```

Minute loop: arbitrage + route risk.
Session loop: contracts, encounters, events, upgrades.
Campaign loop: reputation tiers, licenses, anomalies/artifacts, wars, the Dynasty goal.

## 4. Systems and how they interlock

| System | Drives | Driven by |
|---|---|---|
| **Economy** (real stock/consumption per mooring, price = f(stock/target)) | prices, shortages, profit windows | production specs, population, wars, trade traffic |
| **NPC traffic** (abstract caravans physically move goods when margins exist) | rebalances prices, taxes factions | price gaps, edge safety |
| **Factions & politics** (relations matrix, wars, treaties, treasuries) | embargoes, route risk, demand spikes, contracts | trade taxes, war outcomes, player interference |
| **The Shroud** (seasonal storm tides re-roll edge danger) | route planning, scarcity shocks, anomalies | clock (every 30 days) |
| **Encounters** (pirates, customs, distress calls, caches) | risk/reward on travel | edge risk, war state, scanner tech, cargo legality |
| **Reputation** (−100…+100 per faction, 6 tiers) | gates: licenses, prices, contracts, HQ access | contracts, blockade running, aid deliveries, crimes |
| **Ship progression** (cargo/engine/tank/hull/scanner tiers + licenses) | reach, survivability, information | capital |
| **Contracts** (generated from *live world state*, not canned) | goals with deadlines and stakes | economy gaps, wars, passengers, anomalies |
| **Discovery** (fog of memory, anomalies, 14 artifacts, codex) | long-tail collection, lore, prestige | scanner tier, exploration |

**Causality example:** a Verdant–Syndicate war → Syndicate moorings stop receiving grain →
price ×3 → contracts flood the boards → running food in earns Verdant rep *and* enrages the
Syndicate → Syndicate privateers appear on their lanes → that scarcity also taxes both factions'
caravans, funding the war until a treasury runs dry → treaty → post-war reconstruction
contracts. One cause, many ripples — and the player can be on any side of it.

## 5. World

- ~34 hand-authored *types* of moorings, procedurally placed in 7 regions, procedurally named,
  faction-assigned by region seed. Graph edges guarantee connectivity; lengths = travel hours.
- 5 factions with distinct economies, colors, taxes, aggression:
  **Brass Concord** (industry/ore/alloys), **Verdant Compact** (grain/spice),
  **Tidebound Choir** (water/medicine), **Free Captains' Union** (textiles/fuel hubs),
  **Ashen Syndicate** (armaments/relics).
- 10 goods with base prices, legality tiers, and real production/consumption hooks.
- Every world is a **seed**; new Eras re-roll everything (geography, who hates whom, where
  the Shroud bites).

## 6. Player progression curve

| Time | Player experience |
|---|---|
| 0–30s | Intro, ship docked at Lantern's Rest, milestone ledger visible: "buy 8 grain". |
| ~5 min | First haul sold for real profit; sees prices flash, hears the coin chime, understands *spread*. |
| ~30 min | Contracts, refueling economics, first encounter; buys first hull/engine upgrade. |
| ~2 h | Faction reps diverge; first war likely observed or exploited; license purchased; scanner opens remote markets. |
| ~10 h | Blockade running, war profiteering vs. humanitarian routes; artifact collection underway; Shroud tides re-planed around. |
| ~50 h | Dynasty epilogue → New Era (new seed, legacy bonus) → achievements/archivist completionism, min-max routes. |

**Disclosure order** (mechanics reveal themselves when relevant):
market → travel/fuel → contracts → refuel/repair → encounters → upgrades → reputation tiers →
licenses → scanner intel → anomalies → wars → blockade runs → prestige.

## 7. Economy design

- Price = base × clamp((target/stock)^0.55, 0.3, 3.2). Scarcity is real; gluts are real.
- Player orders move the market (market impact shown pre-purchase) — anti-snowball by physics.
- Market fee 3% (factions skim it — your trade literally funds their wars).
- NPC caravans arbitrage gaps, pay taxes, and are throttled by edge risk. Wars starve lanes of
  traffic → shortages persist → opportunities for brave players.
- Sinks: fuel (burned constantly), repairs, upgrades, licenses, tariffs, encounter losses,
  artifact salvage time. Inflation is bounded because sinks scale with wealth.
- Opportunity cost everywhere: every crate of relics is a crate not carrying grain.

## 8. Events & procedural content

- Travel encounters (6 archetypes) with stat-checked choices (engine/hull/scanner matter).
- World events: riots (supply collapse), harvest booms, gold strikes, treaty summits,
  Shroud tides, war declarations/tributes — all logged, all with mechanical teeth.
- Passengers with generated names and flavor; occasional gifts (artifact clues).
- Anomalies: derelicts/caches/beacons near moorings, scanner-gated, artifact sources.
- Milestone ledger = authored onboarding; achievements = real, stat-verified.

## 9. UX principles

1. The map is the single source of spatial truth; panels are instruments around it.
2. Every number has a tooltip explaining *why* it is that value.
3. Every action produces: a sound, a number change, a log line, and a visible next step.
4. Speed controls (pause/1×/2×/4×) — the player owns time.
5. Progressive disclosure; the tab bar never grows, panels deepen.
6. Responsive: side panel collapses to a bottom sheet under 900px.

## 10. Art direction — "aetherpunk cartography"

Deep indigo void · warm brass/amber accents · teal data-glow · serif display type over
tabular numerals · canvas starfield with drifting embers · faction-colored rings.
All graphics procedural (canvas + CSS + SVG). Zero binary assets.

## 11. Audio

WebAudio-synthesized: UI blips, coin chimes, alerts, event stingers, low ambient drone.
No assets required; master toggle + volume persisted. Autoplay-safe (init on first gesture).

## 12. Monetization (designed, not bolted on)

Cosmetics-and-convenience only, honoring "paying supports the game":
- **Founder's Ledger** (one-time): cosmetic ship trails, mooring nameplates, extra codex art.
- **New Era bundles**: cosmetic themes per season.
- Optional **Premium Chartwright** subscription: cloud saves + cross-device + ghost-trader
  leaderboards per seed (async social: your saved price-influence travels appear as named
  "ghost captains" in friends' worlds on the same seed).
No pay-to-win: the economy's integrity *is* the product.

## 13. Technical architecture

- Zero-build vanilla ES modules served statically; `server.js` is a dependency-free Node
  static server (future home for the sync API).
- **Simulation is pure, DOM-free, deterministic per seed** → unit-testable in Node,
  portable to a future server, safe to serialize.
- State = one plain JSON-serializable object; versioned save schema in localStorage;
  autosave cadence + `beforeunload`; offline catch-up simulates up to 96h at coarse fidelity.
- Rendering: one canvas (map, ships, particles) + DOM panels updated on event bus, throttled.
- Performance budgets: ≤40ms tick, ≤60 caravan objects drawn, no per-frame allocation in the
  render loop, rAF-only animation, panel re-render ≤1Hz unless user is interacting.

## 14. Shipped versions

**v1.0 (all real):** world gen, economy, NPC traffic, politics/wars, Shroud tides,
travel+fuel, encounters, contracts (5 types), reputation+licenses, upgrades, scanner intel,
anomalies+artifacts+codex, achievements, milestones/onboarding, offline catch-up, saves,
audio, responsive UI, prestige.

**v1.1 (shipped):**
- **Production shares** — buy up to 6 shares of a mooring's production line (Friendly rep
  required). Daily dividends track the live local sell price. *Systemic twist:* each share
  expands that mooring's output +2%, deepening local gluts — investing can cannibalize your
  own arbitrage margins, a real capital-allocation dilemma.
- **Crew officers** — generated officers with 6 trait archetypes (Navigator −12% travel,
  Purser +4% sells, Gunner +18% fights, Bosun −30% repairs, Lookout −25% encounters,
  Factor −3% buys). Daily wages are a standing sink; unpaid officers desert. Berths gate
  off cargo-hold progression.
- **Rival captains** — three named NPC competitors whose net worth compounds daily in the
  same world (war profiteering ×1.5), with a live Codex leaderboard and news-line feats.
  Honest simulation, labeled as such — a competitive frame without fake multiplayer.

**v1.2 (shipped) — the aliveness pass:**
- **Juice:** floating profit/loss numbers at the HUD, market-row flashes on trade,
  colored pulse rings on the map for wars/riots/booms/artifact finds.
- **World ticker** — the latest ledger line narrates along the bottom of the map.
- **Today's Reach** — a daily shared seed: every player on a given date generates the
  identical world. A genuine async-social hook with zero backend (determinism pays off).
- **Shroud forecasts** — tides telegraph 2 days ahead; planning beats surprise.
- **Procedural music** — a 14-second-breath chord pad under the ambient drone, synthesized.
- **Codex lore fragments** — three world-history fragments unlock at 3/8/15 charted ports.
- **QoL:** tab hotkeys (M/V/C/F/X/L), pinch-zoom on touch, autosave blink.

## 15. Roadmap ahead

**v1.2:** async multiplayer via seed-synced ghost markets + leaderboards; weekly Shroud event.
**v2.0:** dynasty heirs & succession crisis mode; co-op convoy expeditions; warehouse
ownership; faction HQ interiors; expanded artifact line.
