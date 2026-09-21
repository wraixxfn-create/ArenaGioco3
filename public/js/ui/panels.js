// All DOM panels + HUD. Renders from state; user verbs go through data-act
// delegation into player/actions. No state mutation happens here.

import { bus } from '../core/bus.js';
import { esc, fmtMoney, fmtInt, fmtDate, seasonOf, dayOf } from '../core/util.js';
import { GOODS, GOOD_ORDER } from '../data/goods.js';
import { FACTIONS, FACTION_MAP, repTier, relKey } from '../data/factions.js';
import { ARTIFACTS } from '../data/lore.js';
import { mooringById, neighborsOf } from '../world/gen.js';
import {
  priceOf, buyPrice, sellPrice, spreadFor, capacityOf, tankCapOf, maxHullOf,
  cargoCount, fuelCostOf, findRoute, netWorth, UPGRADES, scannerOf, knownMarkets, bestArbitrage,
} from '../sim/economy.js';
import {
  buyGood, sellGood, refuel, repair, buyUpgrade, acquireLicense, travelTo,
  acceptContract, deliverContract, abandonContract, jettison, scanAnomaly,
  LICENSE_COST, REP_FOR_LICENSE,
} from '../player/actions.js';
import { ACHIEVEMENTS, currentMilestone, isDynasty } from '../sim/progress.js';
import { toast } from './overlay.js';
import { sfx } from '../audio/audio.js';

let getState = null;
let api = null;
let qtyMode = 5;
let activeTab = 'market';
let hintOpen = false;

export function initPanels(getStateFn, apiObj) {
  getState = getStateFn;
  api = apiObj;
  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) setTab(btn.dataset.tab);
  });
  document.getElementById('panel-body').addEventListener('click', onPanelClick);
  document.getElementById('panel-body').addEventListener('change', onPanelChange);
  document.getElementById('mooring-card').addEventListener('click', onPanelClick);
  document.getElementById('milestone-widget').addEventListener('click', (e) => {
    if (e.target.closest('.mw-hint')) { hintOpen = !hintOpen; renderMilestoneWidget(getState()); }
  });
  document.getElementById('tb-speed').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-speed]');
    if (!btn) return;
    const state = getState();
    state.paused = btn.dataset.speed === '0';
    state.speed = Number(btn.dataset.speed) || 1;
    syncSpeedUI(state);
    sfx.click();
  });
}

export function syncSpeedUI(state) {
  document.querySelectorAll('#tb-speed button').forEach((b) => {
    const s = Number(b.dataset.speed);
    b.classList.toggle('on', state.paused ? s === 0 : s === state.speed);
  });
}

export function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('#panel-body .panel').forEach((p) => p.classList.add('hidden'));
  document.getElementById(`p-${tab}`).classList.remove('hidden');
  renderPanel(getState());
  sfx.click();
}

export function getTab() { return activeTab; }

// --- Delegation ----------------------------------------------------------------

function onPanelClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const state = getState();
  const act = el.dataset.act;
  const wrap = (res, then) => {
    if (res.ok) { then?.(); renderAll(state); }
    else { toast(esc(res.reason || 'Cannot do that now.'), 'bad'); sfx.error(); }
  };
  switch (act) {
    case 'qty': qtyMode = el.dataset.q === 'max' ? 'max' : Number(el.dataset.q); renderPanel(state); break;
    case 'buy': {
      const q = qtyMode === 'max' ? capacityOf(state) : qtyMode;
      wrap(buyGood(state, el.dataset.good, q), () => sfx.buy());
      break;
    }
    case 'sell': {
      const have = state.player.cargo[el.dataset.good] || 0;
      const q = qtyMode === 'max' ? have : Math.min(qtyMode, have);
      wrap(sellGood(state, el.dataset.good, q), () => sfx.sell());
      break;
    }
    case 'refuel': {
      const q = el.dataset.q === 'fill' ? tankCapOf(state) : Number(el.dataset.q);
      wrap(refuel(state, q), () => { state.player.flags.refueled = true; sfx.buy(); });
      break;
    }
    case 'repair': wrap(repair(state), () => sfx.upgrade()); break;
    case 'upgrade': wrap(buyUpgrade(state, el.dataset.key), () => sfx.upgrade()); break;
    case 'license': wrap(acquireLicense(state, el.dataset.f), () => sfx.achieve()); break;
    case 'travel': {
      wrap(travelTo(state, el.dataset.to), () => { sfx.travel(); state.ui.selected = null; hideMooringCard(); });
      break;
    }
    case 'accept': wrap(acceptContract(state, el.dataset.id), () => sfx.event()); break;
    case 'deliver': wrap(deliverContract(state, el.dataset.id), () => sfx.coin()); break;
    case 'abandon': wrap(abandonContract(state, el.dataset.id)); break;
    case 'jettison': wrap(jettison(state, el.dataset.good, qtyMode === 'max' ? 999 : qtyMode)); break;
    case 'scan': wrap(scanAnomaly(state, el.dataset.id), () => sfx.event()); break;
    case 'arb': selectMooring(state, el.dataset.to); break;
    case 'close-card': state.ui.selected = null; hideMooringCard(); break;
    case 'tab-market': setTab('market'); break;
    case 'prestige': api.onPrestige(); break;
    case 'newworld': api.onNewWorld(); break;
    default: break;
  }
}

function onPanelChange(e) {
  const state = getState();
  const el = e.target;
  if (el.id === 'set-vol') {
    state.settings.vol = Number(el.value);
    api.onSettings();
  } else if (el.dataset.set) {
    state.settings[el.dataset.set] = el.checked;
    api.onSettings();
  }
}

export function selectMooring(state, id) {
  state.ui.selected = id;
  if (id && id !== state.player.mooring) {
    state.ui.routePreview = findRoute(state, state.player.mooring, id);
  } else {
    state.ui.routePreview = null;
  }
  renderMooringCard(state);
}

export function hideMooringCard() {
  document.getElementById('mooring-card').classList.add('hidden');
}

// --- HUD -------------------------------------------------------------------------

export function updateHUD(state) {
  const p = state.player;
  const m = mooringById(state, p.mooring);
  const set = (id, text) => { document.getElementById(id).textContent = text; };
  set('tb-worth-v', fmtInt(netWorth(state)));
  set('tb-credits-v', fmtInt(p.credits));
  set('tb-cargo-v', `${cargoCount(p)}/${capacityOf(state)}`);
  set('tb-fuel-v', `${Math.floor(p.fuel)}/${tankCapOf(state)}`);
  set('tb-hull-v', `${Math.round(p.hull)}/${maxHullOf(state)}`);
  set('tb-day', `${fmtDate(state.t)} · ${seasonOf(state.t)}`);
  set('tb-loc', p.phase === 'travel' ? `Underway → ${mooringById(state, p.travel.to).name}` : m.name);
  document.getElementById('tb-era').textContent = state.meta.era > 1 ? `ERA ${state.meta.era}` : '';
  document.getElementById('tb-fuel').className = `tb-stat ${p.fuel < 10 ? 'bad' : p.fuel < 18 ? 'warn' : ''}`;
  document.getElementById('tb-hull').className = `tb-stat ${p.hull < 30 ? 'bad' : p.hull < 60 ? 'warn' : ''}`;
}

// --- Mooring card -----------------------------------------------------------------

export function renderMooringCard(state) {
  const card = document.getElementById('mooring-card');
  const sel = state.ui.selected;
  if (!sel) { card.classList.add('hidden'); return; }
  const m = mooringById(state, sel);
  const p = state.player;
  const fac = FACTION_MAP[m.faction];
  const here = p.mooring === sel && p.phase === 'dock';
  const route = sel !== p.mooring ? (state.ui.routePreview || findRoute(state, p.mooring, sel)) : null;

  let routeHtml = '';
  if (!here && route) {
    let fuel = 0;
    for (const eid of route.edgeIds) fuel += fuelCostOf(state.edges.find((e) => e.id === eid), p.ship.engine);
    const stormCount = route.edgeIds.filter((eid) => {
      const e = state.edges.find((x) => x.id === eid);
      return e && e.stormUntil > state.t;
    }).length;
    routeHtml = `<div class="mc-route">
      ⏱ ~${Math.round(route.hours)}h · ${route.path.length - 1} leg${route.path.length > 2 ? 's' : ''} · 🔥 ${Math.ceil(fuel)} embers
      ${stormCount ? `<br><span class="warn">⚠ ${stormCount} stormed lane${stormCount > 1 ? 's' : ''}</span>` : ''}
      ${p.fuel < fuel ? '<br><span class="bad">Not enough fuel for this route.</span>' : ''}
    </div>`;
  }

  const anomaly = state.anomalies.find((a) => !a.salvaged && a.nearMooring === sel);
  let scanHtml = '';
  if (anomaly && here) {
    scanHtml = `<div class="mc-scan">
      <span class="teal">◆ Anomaly detected nearby</span> (${anomaly.kind})<br>
      ${anomaly.scanLeft > 0
        ? '<span class="dim">Scan in progress…</span>'
        : scannerOf(state) < 1
          ? '<span class="dim">Requires Scanner Array L1.</span>'
          : `<button class="btn sm primary" data-act="scan" data-id="${anomaly.id}">📡 Begin scan (2h)</button>`}
    </div>`;
  } else if (anomaly && !here) {
    scanHtml = `<div class="mc-scan dim">◆ Anomaly detected nearby — dock here to work it.</div>`;
  }

  const topGoods = Object.keys(m.target)
    .map((g) => ({ g, p: priceOf(m, g) }))
    .sort((a, b) => (b.p / GOODS[b.g].base) - (a.p / GOODS[a.g].base))
    .slice(0, 3)
    .map(({ g, p: pr }) => `${GOODS[g].icon} ${GOODS[g].name.toLowerCase()} <b class="mono">${pr}</b>`)
    .join(' · ');

  card.innerHTML = `
    <button class="mc-close" data-act="close-card">✕</button>
    <h3>${esc(m.name)}</h3>
    <div class="mc-faction">
      <span class="chip"><span class="dot" style="background:${fac.color}"></span>${fac.name}</span>
      ${m.hq ? '<span class="chip">Faction Seat</span>' : ''}
      ${m.shipyard ? '<span class="chip">⚓ Shipyard</span>' : ''}
    </div>
    ${m.blurb ? `<div class="mc-blurb">${esc(m.blurb)}</div>` : ''}
    <div class="mc-stats">
      <span data-tip="Population drives consumption; happy mouths buy more.">👥 ${fmtInt(m.pop)}</span>
      <span data-tip="Low stability slows production. Shortages cause it.">🏛 ${Math.round(m.stability)}</span>
      <span data-tip="Market fee charged here on every trade.">🧾 ${Math.round(spreadFor(m) * 100)}% fee</span>
    </div>
    <div class="sub">${m.news ? `<span class="warn">📰 ${esc(m.news)}</span><br>` : ''}${topGoods}</div>
    ${routeHtml}
    ${here ? '<div class="mc-route brass">⚓ You are docked here.</div>' : ''}
    <div class="mc-actions">
      ${here
        ? '<button class="btn primary" data-act="tab-market">Open Market</button>'
        : route ? `<button class="btn primary" data-act="travel" data-to="${sel}" ${p.phase !== 'dock' || p.fuel < fuelTotal(state, route) ? 'disabled' : ''}>⛵ Set course</button>` : ''}
    </div>
    ${scanHtml}`;
  card.classList.remove('hidden');
}

function fuelTotal(state, route) {
  let fuel = 0;
  for (const eid of route.edgeIds) fuel += fuelCostOf(state.edges.find((e) => e.id === eid), state.player.ship.engine);
  return fuel;
}

// --- Milestone widget ---------------------------------------------------------------

export function renderMilestoneWidget(state) {
  const el = document.getElementById('milestone-widget');
  const cur = currentMilestone(state);
  if (!cur) {
    el.innerHTML = `<div class="mw-head">🧭 Ledger</div><div class="mw-desc">All milestones complete. Chase achievements — or found your dynasty.</div>`;
    el.classList.remove('hidden');
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="mw-head">🧭 Milestone ${state.milestones.idx + 1}/${7}</div>
    <div class="mw-title">${esc(cur.title)}</div>
    <div class="mw-desc">${esc(cur.desc)}${cur.reward ? ` <span class="brass">+${cur.reward} g</span>` : ''}</div>
    <div class="mw-hint">${hintOpen ? `💡 ${esc(cur.hint)}` : '💡 need a hint?'}</div>`;
}

// --- Panels --------------------------------------------------------------------------

export function renderPanel(state) {
  const fn = { market: renderMarket, ship: renderShip, contracts: renderContracts, factions: renderFactions, codex: renderCodex, log: renderLog }[activeTab];
  if (fn) fn(state);
  updateTabBadges(state);
}

export function renderAll(state) {
  updateHUD(state);
  renderPanel(state);
  renderMooringCard(state);
  renderMilestoneWidget(state);
}

function updateTabBadges(state) {
  const canUse = state.player.phase === 'dock';
  const n = state.contracts.offers.length + state.contracts.active.length;
  document.querySelectorAll('#tabs button').forEach((b) => b.querySelector('.badge')?.remove());
  if (canUse && n > 0) {
    const btn = document.querySelector('#tabs button[data-tab="contracts"]');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = n;
    btn.appendChild(badge);
  }
}

function spark(arr) {
  if (!arr || arr.length < 8) return '';
  const w = 58, h = 16;
  const min = Math.min(...arr), max = Math.max(...arr);
  const span = max - min || 1;
  const pts = arr.map((v, i) => `${(i / (arr.length - 1)) * w},${h - ((v - min) / span) * (h - 2) - 1}`).join(' ');
  const rising = arr[arr.length - 1] > arr[0];
  return `<svg width="${w}" height="${h}" style="opacity:.8"><polyline points="${pts}" fill="none" stroke="${rising ? '#8fd18a' : '#ff6b76'}" stroke-width="1.3"/></svg>`;
}

// --- Market -----------------------------------------------------------------------

function renderMarket(state) {
  const el = document.getElementById('p-market');
  const p = state.player;

  if (p.phase === 'travel') {
    const tr = p.travel;
    const dest = mooringById(state, tr.to);
    const pct = Math.round((tr.t / tr.dur) * 100);
    el.innerHTML = `<div class="travel-note">
      <div class="big">⛵</div>
      <div>Underway to <b class="brass">${esc(dest.name)}</b></div>
      <div class="dim" style="margin:6px 0 12px">leg ${tr.t}/${tr.dur}h${tr.route?.length ? ` · ${tr.route.length + 1} legs remain` : ''}</div>
      <div class="bar" style="max-width:220px;margin:0 auto"><i style="width:${pct}%;background:var(--brass)"></i></div>
      <p class="sub" style="margin-top:16px">Markets reopen at the next dock.<br>While you sail, the Reach keeps trading.</p>
    </div>`;
    return;
  }

  const m = mooringById(state, p.mooring);
  const fac = FACTION_MAP[m.faction];
  const qtyBtns = ['1', '5', '15', 'max'].map((q) =>
    `<button class="qty-btn ${String(qtyMode) === q ? 'on' : ''}" data-act="qty" data-q="${q}">${q === 'max' ? 'Max' : q}</button>`).join('');

  const rows = Object.keys(m.target).map((g) => {
    const bp = buyPrice(m, g), sp = sellPrice(m, g);
    const hist = m.priceHist?.[g];
    const ratio = Math.min(1, (m.stock[g] || 0) / m.target[g]);
    const scarce = ratio < 0.35, glut = ratio > 1.3;
    const have = p.cargo[g] || 0;
    const locked = GOODS[g].restricted && !p.licenses[m.faction];
    const produces = (m.prod[g] || 0) > 0, consumes = (m.cons[g] || 0) > 0;
    return `<div class="mk-row" data-tip="${esc(GOODS[g].blurb)}">
      <div class="gicon">${GOODS[g].icon}</div>
      <div>
        <div class="gname">${GOODS[g].name}${locked ? ' <span class="dim" title="restricted">🔒</span>' : ''}</div>
        <div class="gmeta">
          ${produces ? '<span class="good">⚒ produces</span>' : ''}${consumes ? '<span>🏠 consumes</span>' : ''}
          <span class="${scarce ? 'bad' : glut ? 'good' : 'dim'}">${scarce ? 'scarce' : glut ? 'glut' : 'steady'}</span>
          ${hist ? spark(hist) : ''}
        </div>
      </div>
      <div class="gprice mono">
        ${bp.toFixed(1)}
        <small>sell ${sp.toFixed(1)}</small>
      </div>
      <div class="gbtns">
        <button class="btn sm" data-act="buy" data-good="${g}" ${locked || p.credits < bp ? 'disabled' : ''}>Buy</button>
        <button class="btn sm" data-act="sell" data-good="${g}" ${locked || have === 0 ? 'disabled' : ''}>Sell</button>
      </div>
      <div class="bar stockbar" data-tip="Local stock vs. target. Low stock drives prices up; gluts crash them.">
        <i style="width:${Math.min(100, ratio * 66)}%;background:${scarce ? 'var(--bad)' : glut ? 'var(--good)' : 'var(--teal)'}"></i>
      </div>
    </div>`;
  }).join('');

  const arbs = scannerOf(state) > 0 ? bestArbitrage(state) : [];
  const arbHtml = arbs.length ? `
    <h2 class="sec">Scanner — live margins</h2>
    ${arbs.map((a) => {
      const A = mooringById(state, a.fromId), B = mooringById(state, a.toId);
      return `<div class="arb-row" data-act="arb" data-to="${a.toId}" data-tip="Click to inspect ${esc(B.name)}. Margin shown per crate after fees.">
        <span>${GOODS[a.good].icon}</span>
        <span>${esc(A.name)} → ${esc(B.name)}</span>
        <span class="dim">~${Math.round(a.hours)}h</span>
        <span class="m">+${a.margin.toFixed(1)}/crate</span>
      </div>`;
    }).join('')}` : '';

  el.innerHTML = `
    <div class="mk-head">
      <h3>${esc(m.name)}</h3>
      <div><span class="chip"><span class="dot" style="background:${fac.color}"></span>${fac.short} market · ${Math.round(spreadFor(m) * 100)}% fee</span></div>
      <div class="mk-news">${m.news ? '📰 ' + esc(m.news) : ''}</div>
    </div>
    <div class="qty-row"><span class="lbl">Quantity</span>${qtyBtns}</div>
    ${rows}
    <div class="spread-line">Prices move with local stock. Big orders move the market — check the price after each trade.</div>
    ${arbHtml}`;
}

// --- Ship ---------------------------------------------------------------------------

function renderShip(state) {
  const el = document.getElementById('p-ship');
  const p = state.player;
  const m = mooringById(state, p.mooring);
  const docked = p.phase === 'dock';

  const cargoRows = Object.entries(p.cargo).map(([g, n]) => {
    const here = sellPrice(m, g);
    const avg = p.cargoCost?.[g];
    return `<div class="cargo-row">
      <span>${GOODS[g].icon} ${GOODS[g].name}</span>
      <span class="dim">×${n}</span>
      ${avg ? `<span class="dim" data-tip="Average purchase price">ø ${avg.toFixed(1)}</span>` : ''}
      <span class="cv">${here ? `<span class="dim">here ${here.toFixed(1)} ·</span> <b class="mono">${fmtInt(here * n)}</b>` : ''}
        <button class="btn sm danger" data-act="jettison" data-good="${g}" data-tip="Dump into the clouds. Useful before a customs inspection.">⌄</button>
      </span>
    </div>`;
  }).join('') || '<div class="sub">Hold is empty.</div>';

  const paxRows = p.passengers.map((x) => `<div class="cargo-row"><span>🧍 ${esc(x.name)}</span><span class="cv dim">passenger · 1 berth</span></div>`).join('');

  const hullPct = Math.round((p.hull / maxHullOf(state)) * 100);
  const fuelPct = Math.round((p.fuel / tankCapOf(state)) * 100);

  let yardHtml;
  if (m.shipyard && docked) {
    yardHtml = Object.entries(UPGRADES).map(([key, spec]) => {
      const tier = p.ship[key];
      const maxed = tier >= spec.costs.length;
      const cost = maxed ? null : spec.costs[tier];
      const cur = spec.values[tier];
      const nxt = maxed ? null : spec.values[tier + 1];
      const pips = Array.from({ length: spec.costs.length + 1 }, (_, i) => `<i class="${i <= tier ? 'on' : ''}"></i>`).join('');
      return `<div class="up-row">
        <div class="icon">${spec.icon}</div>
        <div class="info">
          <div class="nm">${spec.name} <span class="pips">${pips}</span></div>
          <div class="ds">${spec.desc}${maxed ? '' : ` · ${cur}${spec.unit.startsWith('×') ? spec.unit.slice(1) : ''} → ${nxt}`}</div>
        </div>
        <button class="btn sm ${maxed ? '' : 'primary'}" data-act="upgrade" data-key="${key}" ${maxed || p.credits < cost ? 'disabled' : ''}>
          ${maxed ? 'MAX' : fmtMoney(cost)}
        </button>
      </div>`;
    }).join('');
  } else {
    const nearest = nearestShipyard(state);
    yardHtml = `<div class="card"><div class="sub">No shipyard at ${esc(m.name)}.${nearest ? ` Nearest: <b class="brass">${esc(nearest.m.name)}</b> (${nearest.hops} leg${nearest.hops > 1 ? 's' : ''}, ~${Math.round(nearest.hours)}h).` : ''}</div></div>`;
  }

  const licRows = FACTIONS.map((f) => {
    const owned = p.licenses[f.id];
    const rep = p.rep[f.id] || 0;
    const eligible = rep >= REP_FOR_LICENSE && p.credits >= LICENSE_COST;
    return `<div class="lic-row">
      <span class="dot" style="width:9px;height:9px;border-radius:50%;background:${f.color};display:inline-block"></span>
      <span style="flex:1">${f.short}</span>
      ${owned
        ? '<span class="good">✓ licensed</span>'
        : `<span class="dim" data-tip="Requires Friendly standing (+${REP_FOR_LICENSE} rep) and the charter fee.">${rep}/${REP_FOR_LICENSE} rep · ${fmtMoney(LICENSE_COST)}</span>
           <button class="btn sm" data-act="license" data-f="${f.id}" ${eligible && docked ? '' : 'disabled'}>Charter</button>`}
    </div>`;
  }).join('');

  const embPrice = buyPrice(m, 'embers');
  el.innerHTML = `
    <h2 class="sec">Vessel — <span class="dim" style="font-size:12px">The Emberwake</span></h2>
    <div class="stat-grid">
      <div class="stat-box" data-tip="Hull integrity. Repair at shipyards. At zero, salvage tugs take their fee.">
        <div class="lbl">Hull</div><div class="val">${Math.round(p.hull)} / ${maxHullOf(state)}</div>
        <div class="bar"><i style="width:${hullPct}%;background:${hullPct < 30 ? 'var(--bad)' : 'var(--good)'}"></i></div>
      </div>
      <div class="stat-box" data-tip="Ember fuel. Every leg burns embers; embers are also a trade good.">
        <div class="lbl">Fuel</div><div class="val">${Math.floor(p.fuel)} / ${tankCapOf(state)}</div>
        <div class="bar"><i style="width:${fuelPct}%;background:${fuelPct < 25 ? 'var(--warn)' : 'var(--brass)'}"></i></div>
      </div>
      <div class="stat-box" data-tip="Cargo capacity. Upgrade at shipyards.">
        <div class="lbl">Cargo</div><div class="val">${cargoCount(p)} / ${capacityOf(state)}</div>
        <div class="bar"><i style="width:${(cargoCount(p) / capacityOf(state)) * 100}%;background:var(--teal)"></i></div>
      </div>
      <div class="stat-box" data-tip="Scanner range: 0=visited only, 1=adjacent, 2=two hops, 3=all markets. Also unlocks anomaly salvage.">
        <div class="lbl">Scanner</div><div class="val">L${scannerOf(state)}</div>
        <div class="dim" style="font-size:10.5px">${['visited markets only', 'adjacent markets', '2-hop markets', 'all markets'][scannerOf(state)]}</div>
      </div>
    </div>

    <div style="display:flex;gap:6px;margin-bottom:14px">
      <button class="btn" data-act="refuel" data-q="10" ${docked && embPrice ? '' : 'disabled'}>🔥 +10 embers ${embPrice ? `(${fmtMoney(Math.round(embPrice * 10))})` : ''}</button>
      <button class="btn" data-act="refuel" data-q="fill" ${docked && embPrice ? '' : 'disabled'}>Fill tanks</button>
      ${m.shipyard ? `<button class="btn" data-act="repair" ${docked && p.hull < maxHullOf(state) ? '' : 'disabled'}>🛠 Repair ${p.hull < maxHullOf(state) ? `(${fmtMoney(Math.round((maxHullOf(state) - p.hull) * 2.2))})` : ''}</button>` : ''}
    </div>

    <h2 class="sec">Cargo hold</h2>
    <div class="card">${cargoRows}${paxRows}</div>

    <h2 class="sec">Outfitting ${m.shipyard ? '' : '<span class="dim" style="font-size:11px">(requires shipyard ⚓)</span>'}</h2>
    ${yardHtml}

    <h2 class="sec">Trading licenses</h2>
    <div class="card">${licRows}</div>
    <div class="sub" data-tip="Licenses unlock restricted goods (armaments, relics) at that faction's moorings and grant their trust prices.">Licenses unlock restricted goods — armaments and relics — at that faction's moorings.</div>`;
}

function nearestShipyard(state) {
  let best = null;
  for (const m of state.moorings) {
    if (!m.shipyard || m.id === state.player.mooring) continue;
    const r = findRoute(state, state.player.mooring, m.id);
    if (r && (!best || r.hours < best.hours)) best = { m, hours: r.hours, hops: r.path.length - 1 };
  }
  return best;
}

// --- Contracts ------------------------------------------------------------------------

function renderContracts(state) {
  const el = document.getElementById('p-contracts');
  const p = state.player;
  const hoursLeft = state.contracts.nextRefresh - state.t;

  const offerCard = (o) => {
    const deadlineH = o.deadline - state.t;
    const kindLbl = { delivery: '📦 Delivery', courier: '✉️ Courier', passenger: '🧍 Passenger', blockade: '🏴 Blockade run', relief: '🤝 Relief run' }[o.kind];
    const dest = mooringById(state, o.to);
    const need = o.good ? `${o.qty} ${GOODS[o.good].name.toLowerCase()}` : o.kind === 'courier' ? 'the sealed dispatch' : 'one passenger';
    const canAccept = p.phase === 'dock' && state.contracts.active.length < 3;
    return `<div class="ct-card">
      <div class="ct-kind">${kindLbl} · ${FACTION_MAP[o.repFaction].short}</div>
      <div class="ct-flavor">${esc(o.flavor)}</div>
      <div class="ct-meta">
        <span>need <b>${need}</b></span>
        ${o.from ? `<span>collect <b>${esc(mooringById(state, o.from).name)}</b></span>` : ''}
        <span>deliver <b>${esc(dest.name)}</b></span>
        <span>within <b>${deadlineH}h</b></span>
        <span>pays <b class="brass">${fmtMoney(o.reward)}</b>${o.advance ? ` <span class="good">+${fmtMoney(o.advance)} advance</span>` : ''}</span>
        <span>rep <b class="good">+${o.repReward}</b>${o.riskFaction ? ` <span class="bad">· ${FACTION_MAP[o.riskFaction].short} −3</span>` : ''}</span>
      </div>
      <div class="ct-actions">
        <button class="btn sm primary" data-act="accept" data-id="${o.id}" ${canAccept ? '' : 'disabled'}>Sign contract</button>
        ${o.kind === 'delivery' && o.from !== p.mooring ? `<span class="dim" style="font-size:11px">you must collect the cargo at ${esc(mooringById(state, o.from).name)} first</span>` : ''}
      </div>
    </div>`;
  };

  const activeCard = (c) => {
    const dest = mooringById(state, c.to);
    const atDest = p.mooring === c.to && p.phase === 'dock';
    const have = c.good ? (p.cargo[c.good] || 0) : Infinity;
    const ready = atDest && have >= (c.qty || 0);
    const remaining = c.deadline - state.t;
    const route = p.mooring !== c.to ? findRoute(state, p.mooring, c.to) : null;
    return `<div class="ct-card active">
      <div class="ct-kind">${c.kind === 'blockade' ? '🏴 Blockade' : c.kind === 'relief' ? '🤝 Relief' : '📜 Active'} → ${esc(c.toName)}</div>
      <div class="ct-progress">
        ${c.good ? `cargo: <b class="${have >= c.qty ? 'good' : 'bad'}">${have}/${c.qty}</b> ${GOODS[c.good].name.toLowerCase()} · ` : ''}
        ${c.kind === 'passenger' ? `passenger: <b>${esc(c.name)}</b> aboard · ` : ''}
        time left: <b class="${remaining < 12 ? 'bad' : ''}">${remaining}h</b>
        ${route ? ` · route: ~${Math.round(route.hours)}h, ${route.path.length - 1} leg${route.path.length > 2 ? 's' : ''}` : ''}
      </div>
      <div class="ct-actions">
        <button class="btn sm primary" data-act="deliver" data-id="${c.id}" ${ready ? '' : 'disabled'}>${ready ? '📦 Deliver now' : atDest ? 'Cargo short' : 'Not at destination'}</button>
        <button class="btn sm danger" data-act="abandon" data-id="${c.id}">Abandon (−3 rep)</button>
      </div>
    </div>`;
  };

  el.innerHTML = `
    <h2 class="sec">Active contracts <span class="dim" style="font-size:11px">(${state.contracts.active.length}/3)</span></h2>
    ${state.contracts.active.map(activeCard).join('') || '<div class="sub">Nothing signed. The boards below refresh with the world.</div>'}
    <h2 class="sec">Contract board <span class="dim" style="font-size:11px">— refreshes in ${Math.max(0, hoursLeft)}h</span></h2>
    ${p.phase === 'travel' ? '<div class="sub" style="margin-bottom:9px">You can sign contracts once docked.</div>' : ''}
    ${state.contracts.offers.map(offerCard).join('') || '<div class="sub">The board is bare. Factions post as needs arise — wars make them generous.</div>'}
    <div class="sub" style="margin-top:10px">${state.contracts.history.length} past engagement${state.contracts.history.length === 1 ? '' : 's'} in the ledger.</div>`;
}

// --- Factions ------------------------------------------------------------------------

function renderFactions(state) {
  const el = document.getElementById('p-factions');
  const wars = state.wars.map((w) => `<div class="war-banner">⚔️ <b>${FACTION_MAP[w.a].short}</b> at war with <b>${FACTION_MAP[w.b].short}</b> — day ${Math.floor((state.t - w.since) / 24) + 1}. Their lanes are dangerous; their needs are lucrative.</div>`).join('');

  const cards = FACTIONS.map((f) => {
    const rep = state.player.rep[f.id] || 0;
    const tier = repTier(rep);
    const fs = state.factions.find((x) => x.id === f.id);
    const mood = fs.treasury > 12000 ? 'flush' : fs.treasury > 5000 ? 'stable' : fs.treasury > 2000 ? 'strained' : 'desperate';
    const atWar = state.wars.some((w) => w.a === f.id || w.b === f.id);
    const owned = state.moorings.filter((m) => m.faction === f.id).length;
    const enemies = [];
    for (const g of FACTIONS) {
      if (g.id === f.id) continue;
      const v = state.relations[relKey(f.id, g.id)] || 0;
      if (v <= -40) enemies.push(`<span class="bad">${g.short} ${Math.round(v)}</span>`);
      else if (v >= 30) enemies.push(`<span class="good">${g.short} ${Math.round(v)}</span>`);
    }
    return `<div class="fa-card">
      <div class="fa-head">
        <span class="swatch" style="background:${f.color}"></span>
        <h4>${f.name}</h4>
        <span class="chip" style="color:${tier.color};border-color:${tier.color}55" data-tip="Your standing. Friendly (+20) unlocks licenses; Exalted (+80) is dynasty material.">${tier.name} ${rep >= 0 ? '+' : ''}${Math.round(rep)}</span>
      </div>
      <div class="fa-motto">“${f.motto}”</div>
      <div class="repbar" data-tip="Reputation from −100 to +100"><i style="left:${(rep + 100) / 2}%"></i></div>
      <div class="fa-desc">${f.personality}</div>
      <div class="ct-meta">
        <span>${owned} moorings</span>
        <span>treasury <b class="${mood === 'desperate' ? 'bad' : ''}">${mood}</b></span>
        ${atWar ? '<span class="bad">⚔ at war</span>' : ''}
        ${state.player.licenses[f.id] ? '<span class="good">✓ licensed</span>' : ''}
      </div>
      ${enemies.length ? `<div class="sub" style="margin-top:4px">Relations: ${enemies.join(' · ')}</div>` : ''}
    </div>`;
  }).join('');

  const treaties = state.treaties.slice(-3).reverse().map((t) =>
    `<div class="log-row"><span class="lt">D${dayOf(t.t)}</span><span>🕊️ ${FACTION_MAP[t.a].short} and ${FACTION_MAP[t.b].short} signed a treaty.</span></div>`).join('');

  el.innerHTML = `${wars}${cards}${treaties ? '<h2 class="sec">Recent treaties</h2>' + treaties : ''}`;
}

// --- Codex ------------------------------------------------------------------------

function renderCodex(state) {
  const el = document.getElementById('p-codex');
  const p = state.player;
  const worth = netWorth(state);
  const dyn = isDynasty(state);
  const checks = [
    [worth >= 200000, `Net worth ${fmtInt(worth)} / 200,000`],
    [Object.keys(p.licenses).length >= 3, `Licenses ${Object.keys(p.licenses).length} / 3`],
    [Object.values(p.rep).some((v) => v >= 80), `An Exalted patron (${Math.round(Math.max(...Object.values(p.rep)))} / 80 best standing)`],
  ];

  const achs = ACHIEVEMENTS.map((a) => {
    const won = !!state.achievements[a.id];
    return `<div class="ach ${won ? 'won' : ''}" ${won ? `data-tip="Earned day ${dayOf(state.achievements[a.id])}"` : ''}>
      <div class="nm">${a.icon} ${a.name}</div><div>${a.desc}</div>
    </div>`;
  }).join('');

  const arts = ARTIFACTS.map((a) => {
    const owned = !!state.artifacts[a.id];
    const archived = state.meta.archive?.includes(a.id);
    return `<div class="art ${owned || archived ? 'owned' : ''}" ${owned ? `data-tip="${esc(a.lore)}"` : archived ? 'data-tip="Recovered in a former era. The Shroud keeps its own ledgers."' : ''}>
      <div class="ic">${a.icon}</div>
      <div class="nm">${owned ? a.name : archived ? `${a.name} (era ${state.meta.era - 1})` : '? ? ?'}</div>
    </div>`;
  }).join('');

  const s = p.stats;
  const statsHtml = [
    ['Trades made', s.trades], ['Trading margin', fmtMoney(s.profit)], ['Contracts delivered', s.delivered], ['Contracts failed', s.failed],
    ['Blockade runs', s.blockades], ['Legs sailed', s.legs], ['Ports visited', s.visited.length], ['Storm legs', s.storms],
    ['Artifacts recovered', s.artifacts], ['Anomalies scanned', s.scanned], ['Total earned', fmtMoney(s.earnedTotal)], ['Total spent', fmtMoney(s.spentTotal)],
  ].map(([k, v]) => `<div><span>${k}</span><span>${typeof v === 'number' ? fmtInt(v) : v}</span></div>`).join('');

  el.innerHTML = `
    <h2 class="sec">The Grand Charter</h2>
    <div class="card ${dyn ? 'glow' : ''}">
      <div class="sub" style="margin-bottom:7px">Found a <b class="brass">Trade Dynasty</b> — the Reach remembers houses, not captains.</div>
      ${checks.map(([okd, txt]) => `<div class="dyn-check"><span class="mark">${okd ? '✅' : '⬜'}</span><span class="${okd ? '' : 'dim'}">${txt}</span></div>`).join('')}
      <div style="margin-top:9px">
        <button class="btn primary block" data-act="prestige" ${dyn ? '' : 'disabled'}>👑 Found the Dynasty${state.meta.era > 1 ? ` (Era ${state.meta.era + 1})` : ''}</button>
      </div>
    </div>

    <h2 class="sec">Achievements</h2>
    <div class="ach-grid">${achs}</div>

    <h2 class="sec">Artifacts <span class="dim" style="font-size:11px">${Object.keys(state.artifacts).length}/${ARTIFACTS.length}</span></h2>
    <div class="art-grid">${arts}</div>

    <h2 class="sec">Ledger of deeds</h2>
    <div class="stats-grid">${statsHtml}</div>

    <h2 class="sec">Settings</h2>
    <div class="card">
      <div class="set-row"><span>Sound effects</span><input type="checkbox" data-set="audio" ${state.settings.audio ? 'checked' : ''}></div>
      <div class="set-row"><span>Ambient drone</span><input type="checkbox" data-set="ambient" ${state.settings.ambient ? 'checked' : ''}></div>
      <div class="set-row"><span>Vex's advice</span><input type="checkbox" data-set="hints" ${state.settings.hints ? 'checked' : ''}></div>
      <div class="set-row"><span>Volume</span><input type="range" id="set-vol" min="0" max="1" step="0.05" value="${state.settings.vol}"></div>
      <div class="set-row"><span>World seed</span><span class="dim mono">${esc(state.meta.seed)}</span></div>
      <div class="set-row"><span>Abandon this voyage</span><button class="btn sm danger" data-act="newworld">New world…</button></div>
    </div>`;
}

// --- Log ------------------------------------------------------------------------

function renderLog(state) {
  const el = document.getElementById('p-log');
  el.innerHTML = `<h2 class="sec">World ledger</h2>` + state.log.slice(0, 70).map((l) =>
    `<div class="log-row ${l.type}"><span class="lt">D${dayOf(l.t)}</span><span>${esc(l.text)}</span></div>`).join('');
}

export { bus };
