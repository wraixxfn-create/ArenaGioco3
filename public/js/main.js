// EMBERWAKE — boot, main loop, and the glue between sim, UI, and audio.

import { bus } from './core/bus.js';
import { esc, dailySeed } from './core/util.js';
import { loadGame, saveGame } from './core/save.js';
import { generateWorld, mooringById } from './world/gen.js';
import { tickOnce, runOffline, TICK_MS } from './sim/sim.js';
import { refreshOffers } from './sim/contracts.js';
import { checkMilestones, checkAchievements, isDynasty } from './sim/progress.js';
import { resolveEncounterChoice, checkCatastrophe } from './player/actions.js';
import { FACTION_MAP } from './data/factions.js';
import { VEX_LINES } from './data/names.js';
import { initAudio, configureAudio, sfx } from './audio/audio.js';
import { initMap, addPulse } from './ui/map.js';
import {
  initPanels, renderAll, renderPanel, updateHUD, renderMooringCard,
  renderMilestoneWidget, selectMooring, setTab, getTab, syncSpeedUI,
} from './ui/panels.js';
import { bindTooltips, toast, vexSay, modal, showIntro, closeModal, floatNumber } from './ui/overlay.js';

let state = null;
let encounterOpen = false;
let ticks = 0;
let lowFuelWarned = false;
let lastTickerT = -1;

// --- Boot ---------------------------------------------------------------------

function freshSeed() {
  return `reach-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

function boot() {
  const loaded = loadGame();
  let offlineSummary = null;

  if (loaded) {
    state = loaded;
    const elapsedH = Math.floor((Date.now() - (state.savedAt || Date.now())) / 3600000);
    if (elapsedH >= 2) {
      const hours = Math.min(96, elapsedH);
      offlineSummary = runOffline(state, hours);
    }
  } else {
    state = generateWorld(freshSeed());
    state.paused = true;
  }

  // Ensure the contract board is stocked from the first minute.
  if (!state.contracts.offers.length) refreshOffers(state);

  configureAudio(state.settings);
  bindTooltips();
  initPanels(() => state, {
    onPrestige: prestige,
    onNewWorld: confirmNewWorld,
    onSettings: applySettings,
  });
  initMap({
    canvas: document.getElementById('map'),
    getState: () => state,
    onSelect: (id) => {
      if (id == null) return;
      sfx.click();
      selectMooring(state, id);
    },
    onAnomaly: (anomId) => {
      const a = state.anomalies.find((x) => x.id === anomId);
      if (!a) return;
      selectMooring(state, a.nearMooring);
      toast('◆ Anomaly detected. Dock at the adjacent mooring and scan it (Scanner L1 required).', 'event');
    },
  });

  wireBusEvents();
  syncSpeedUI(state);
  renderAll(state);
  syncSpeedUI(state);

  if (!loaded) {
    showIntro((seed) => {
      if (seed) {
        state = generateWorld(seed);
        refreshOffers(state);
        toast(`🌅 <b>Today's Reach.</b> Every captain playing today sails this same sky.`, 'event', 7000);
      }
      state.paused = false;
      if (state.settings.hints) vexSay(VEX_LINES.welcome);
      saveGame(state);
      renderAll(state);
    }, { dailySeed: dailySeed() });
  } else if (offlineSummary) {
    modal({
      icon: '🌫️',
      title: 'While you were away',
      html: `<p>The Reach kept turning for <b>${offlineSummary.hours} hours</b>${offlineSummary.days ? ` (${offlineSummary.days} day${offlineSummary.days > 1 ? 's' : ''})` : ''}.</p>
        <p>Markets shifted with the tides of supply.
        ${offlineSummary.wars ? `⚔️ <b>${offlineSummary.wars} war${offlineSummary.wars > 1 ? 's' : ''} broke out.</b>` : 'No new wars broke out.'}
        ${offlineSummary.treaties ? `🕊️ ${offlineSummary.treaties} treat${offlineSummary.treaties > 1 ? 'ies were' : 'y was'} signed.` : ''}</p>
        <p class="flavor">Your ship stayed safely docked. The world did not.</p>`,
      buttons: [{ label: 'Return to the helm', cls: 'primary' }],
    });
  }

  // Autosave with a quiet "saved" blink.
  const saveAndBlink = () => { if (saveGame(state)) flashSaved(); };
  setInterval(saveAndBlink, 12000);
  window.addEventListener('beforeunload', () => saveGame(state));
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveAndBlink(); });

  bindKeyboard();
  requestAnimationFrame(loop);
}

// --- Main loop ------------------------------------------------------------------

let last = performance.now();
let acc = 0;

function loop(now) {
  const dt = Math.min(250, now - last);
  last = now;
  if (!state.paused && !encounterOpen) {
    const step = TICK_MS / state.speed;
    acc += dt;
    let guard = 0;
    while (acc >= step && guard++ < 8) {
      acc -= step;
      doTick();
    }
  }
  requestAnimationFrame(loop);
}

function doTick() {
  tickOnce(state);
  ticks++;

  if (state.pendingEncounter && !encounterOpen) openEncounter();

  checkMilestones(state);
  checkAchievements(state);
  const cat = checkCatastrophe(state);
  if (cat) {
    sfx.damage();
    modal({
      icon: '💥', title: 'Salvage rescue',
      html: `<p>Your hull gave out over open sky. Salvage tugs hauled you to <b>${esc(mooringById(state, cat.near).name)}</b>.</p>
        <p>They kept ${cat.lost.length ? cat.lost.join(', ') : 'no cargo'} and a ${cat.fee} g towing fee. The sea is patient with fools, but it charges interest.</p>`,
      buttons: [{ label: 'Limp to the docks', cls: 'primary' }],
    });
    renderAll(state);
  }

  updateHUD(state);
  updateTicker();
  if (ticks % 4 === 0) {
    renderPanel(state);
    renderMooringCard(state);
  }
  if (ticks % 20 === 0) renderMilestoneWidget(state);
  if (!lowFuelWarned && state.player.fuel < 10 && state.player.phase === 'dock' && state.settings.hints) {
    lowFuelWarned = true;
    vexSay(VEX_LINES.lowFuel);
  }
  // Relief work surfaces the moment a captain goes broke.
  const p = state.player;
  if (p.credits < 150 && cargoEmpty(p) && !state.contracts.active.length) {
    if (!state.contracts.offers.some((o) => o.kind === 'relief')) refreshOffers(state);
    if (!p.flags.vexBroke && state.settings.hints) {
      p.flags.vexBroke = true;
      vexSay(VEX_LINES.broke);
    }
    if (getTab() === 'contracts') renderPanel(state);
  }
}

function cargoEmpty(p) {
  return Object.values(p.cargo).reduce((a, b) => a + b, 0) + p.passengers.length === 0;
}

function flashSaved() {
  const el = document.getElementById('tb-saved');
  if (!el) return;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 1400);
}

// The Reach narrates itself along the bottom of the map.
function updateTicker() {
  const latest = state.log[0];
  const el = document.getElementById('ticker');
  if (!latest || !el || latest.t === lastTickerT) return;
  lastTickerT = latest.t;
  el.textContent = latest.text;
  el.classList.remove('hidden');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.add('hidden'), 9000);
}

// --- Encounters -------------------------------------------------------------------

function openEncounter() {
  const enc = state.pendingEncounter;
  if (!enc) return;
  encounterOpen = true;
  sfx.alert();
  modal({
    icon: enc.icon,
    title: enc.title,
    html: `<p>${enc.text}</p>`,
    dismissable: false,
    buttons: enc.choices.map((c, i) => ({
      label: c.label,
      hint: c.hint,
      onClick: () => {
        const result = resolveEncounterChoice(state, i);
        encounterOpen = false;
        checkCatastrophe(state);
        renderAll(state);
        saveGame(state);
        modal({
          icon: enc.icon, title: enc.title,
          html: `<p class="flavor">${enc.text}</p>`,
          buttons: [], dismissable: true,
        });
        const box = document.querySelector('#modal-root .modal');
        if (box && result) {
          const r = document.createElement('div');
          r.className = 'm-result';
          r.textContent = result.text;
          box.querySelector('.m-body').appendChild(r);
          const btn = document.createElement('button');
          btn.className = 'btn primary';
          btn.textContent = 'Continue';
          btn.addEventListener('click', closeModal);
          box.querySelector('.m-buttons').appendChild(btn);
        }
      },
    })),
  });
}

// --- Bus wiring ---------------------------------------------------------------------

function wireBusEvents() {
  bus.on('dock', () => { sfx.dock(); lowFuelWarned = false; renderAll(state); });
  bus.on('travel', () => { renderAll(state); });
  bus.on('trade', (e) => {
    if (e.dir === 'buy' && state.settings.hints && !state.player.flags.vexBuy) { state.player.flags.vexBuy = true; setTimeout(() => vexSay(VEX_LINES.firstBuy), 600); }
    if (e.dir === 'sell' && state.settings.hints && !state.player.flags.vexSell) { state.player.flags.vexSell = true; setTimeout(() => vexSay(VEX_LINES.firstSell), 600); }
    if (e.dir === 'sell' && e.profit != null) floatNumber(`${e.profit >= 0 ? '+' : ''}${Math.round(e.profit)} g`, e.profit >= 0 ? 'good' : 'bad');
    if (e.dir === 'buy' && e.cost != null) floatNumber(`−${Math.round(e.cost)} g`, 'bad');
    renderPanel(state);
  });
  bus.on('contract-accept', () => {
    if (state.settings.hints && !state.player.flags.vexContract) { state.player.flags.vexContract = true; vexSay(VEX_LINES.firstContract); }
    renderPanel(state);
  });
  bus.on('contract-deliver', (c) => { floatNumber(`+${c.reward} g`, 'good'); toast(`📦 Delivered: +${c.reward} g, ${FACTION_MAP[c.repFaction].short} rep +${c.repReward}.`, 'good'); });
  bus.on('contract-warning', () => { sfx.alert(); toast('⏳ <b>Contract deadline:</b> 12 hours remain on a signed job.', 'bad', 6000); });
  bus.on('charted', ({ mooringId }) => { toast(`🗺️ <b>${esc(mooringById(state, mooringId).name)}</b> charted. +25 g bounty.`, 'good', 4500); });
  bus.on('crew-desert', (gone) => { toast(`💸 Wages ran dry — <b>${esc(gone.name)}</b> deserted the crew.`, 'bad', 6000); });
  bus.on('war', (w) => {
    sfx.war();
    toast(`⚔️ <b>War:</b> ${FACTION_MAP[w.a].name} vs ${FACTION_MAP[w.b].name}. Their lanes grow dangerous — and profitable.`, 'bad', 8000);
    for (const m of state.moorings) {
      if (m.faction === w.a || m.faction === w.b) addPulse(m.id, '#ff6b76');
    }
    if (state.settings.hints && !state.player.flags.vexWar) { state.player.flags.vexWar = true; setTimeout(() => vexSay(VEX_LINES.warStart), 1200); }
    renderPanel(state);
  });
  bus.on('treaty', (w) => {
    sfx.treaty();
    toast(`🕊️ <b>Peace:</b> ${FACTION_MAP[w.a].short} and ${FACTION_MAP[w.b].short} sign a treaty.`, 'event', 7000);
    renderPanel(state);
  });
  bus.on('tide', () => {
    sfx.alert();
    toast('🌫️ <b>Shroud tide!</b> Storm-walls have shifted. Check your routes before committing cargo.', 'event', 8000);
    if (state.settings.hints) setTimeout(() => vexSay(VEX_LINES.storm), 1500);
  });
  bus.on('tide-warning', () => {
    sfx.event();
    toast('🌫️ <b>The Shroud stirs.</b> Tide forecast within two days — plan your lanes.', 'event', 7000);
  });
  bus.on('world-event', (e) => {
    addPulse(e.mooring, e.kind === 'riot' ? '#ff6b76' : '#8fd18a');
    sfx.event();
    if (getTab() === 'market') renderPanel(state);
  });
  bus.on('artifact', (ar) => {
    sfx.artifact();
    addPulse(state.player.mooring, '#4fd8c8');
    toast(`🏺 <b>${ar.name}</b> recovered!<br><span class="dim">${esc(ar.lore)}</span>`, 'event', 9000);
  });
  bus.on('salvage', (e) => { toast(`📡 Salvage complete: ${esc(e.out)}`, 'good', 6000); });
  bus.on('milestone', (m) => {
    sfx.achieve();
    toast(`🧭 <b>Milestone:</b> ${esc(m.title)}${m.reward ? ` — +${m.reward} g` : ''}`, 'good');
    renderMilestoneWidget(state);
  });
  bus.on('achievement', (a) => {
    sfx.achieve();
    toast(`🏅 <b>Achievement:</b> ${a.icon} ${a.name}<br><span class="dim">${a.desc}</span>`, 'good', 6000);
  });
  bus.on('upgrade', () => { renderPanel(state); });
  bus.on('rep', () => { if (getTab() === 'factions' || getTab() === 'ship') renderPanel(state); });
  bus.on('license', () => { toast('📜 License chartered. Restricted goods await.', 'good'); renderPanel(state); });
}

// --- Meta actions ---------------------------------------------------------------------

function prestige() {
  if (!isDynasty(state)) return;
  const era = state.meta.era + 1;
  const archive = [...new Set([...(state.meta.archive || []), ...Object.keys(state.artifacts)])];
  const achievements = { ...state.achievements };
  const bonus = Math.min(0.3, (state.meta.legacyBonus || 0) + 0.05);
  modal({
    icon: '👑', title: 'A dynasty is founded',
    html: `<p>The charters are signed in five colors of ink. Your name goes from ledgers into <b>history</b>.</p>
      <p>Era ${era} begins with a fresh Reach — new moorings, new grudges, new margins — carrying <b>+${Math.round(bonus * 100)}% starting gilds</b> as your house's legacy.</p>
      <p class="flavor">Your artifacts pass into the archive. Achievements are forever.</p>`,
    buttons: [
      {
        label: '⛵ Begin the new era', cls: 'primary',
        onClick: () => {
          const seed = `era${era}-${state.meta.seed}`;
          const next = generateWorld(seed, { era, legacyBonus: bonus, archive });
          next.achievements = achievements;
          next.player.credits = Math.round(1200 * (1 + bonus));
          state = next;
          saveGame(state);
          toast(`👑 <b>Era ${era} begins.</b> The Reach does not know you yet. That will not last.`, 'good', 8000);
          renderAll(state);
          setTab('market');
        },
      },
      { label: 'Keep sailing this era', onClick: () => {} },
    ],
  });
}

function confirmNewWorld() {
  modal({
    icon: '🌍', title: 'Chart a new world',
    html: `<p>Abandon this voyage and generate a fresh Reach from a seed of your choosing.
      <b>Your current save will be replaced.</b> Achievements do not carry over outside a dynasty.</p>
      <p><input type="text" id="seed-input" placeholder="seed — leave blank for random" /></p>`,
    buttons: [
      {
        label: 'Set sail into the new world', cls: 'primary',
        onClick: () => {
          const seed = document.getElementById('seed-input')?.value.trim() || freshSeed();
          state = generateWorld(seed);
          saveGame(state);
          toast('🌍 A new Reach unfolds. Same sky, different debts.', 'event');
          renderAll(state);
          setTab('market');
        },
      },
      { label: 'Stay', onClick: () => {} },
    ],
  });
}

function applySettings() {
  configureAudio({ enabled: state.settings.audio, ambient: state.settings.ambient, vol: state.settings.vol });
  saveGame(state);
}

// Debug/automation hook (used by the headless smoke test and future e2e).
if (typeof window !== 'undefined') {
  window.EMBERWAKE = {
    get state() { return state; },
    selectMooring: (id) => selectMooring(state, id),
    setTab: (t) => setTab(t),
    saveNow: () => saveGame(state),
  };
}

function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      state.paused = !state.paused;
      if (!state.paused) sfx.click();
      syncSpeedUI(state);
    } else if (e.key === 'Escape') {
      closeModal();
    } else if (['1', '2', '3'].includes(e.key)) {
      const speed = { 1: 1, 2: 2, 3: 4 }[Number(e.key)];
      state.speed = speed;
      state.paused = false;
      syncSpeedUI(state);
    } else if (e.key === 'm' || e.key === 'M') setTab('market');
    else if (e.key === 'v' || e.key === 'V') setTab('ship');
    else if (e.key === 'c' || e.key === 'C') setTab('contracts');
    else if (e.key === 'f' || e.key === 'F') setTab('factions');
    else if (e.key === 'x' || e.key === 'X') setTab('codex');
    else if (e.key === 'l' || e.key === 'L') setTab('log');
  });
  document.addEventListener('pointerdown', () => initAudio(), { once: true });
}

boot();
