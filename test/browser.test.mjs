// Headless browser smoke test (jsdom): boots the real index.html DOM, runs
// main.js, clicks through intro/tabs/market/travel, asserts the game plays.

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf-8');
const dom = new JSDOM(html, { url: 'http://localhost:8080/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

// --- Browser globals for the ESM game code ---------------------------------
global.window = window;
global.document = window.document;
global.localStorage = window.localStorage;
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
try { Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true }); } catch { /* node ≥21 provides its own */ }
global.HTMLElement = window.HTMLElement;

const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.error || e.message)));
process.on('uncaughtException', (e) => errors.push(`uncaught: ${e.stack}`));
process.on('unhandledRejection', (e) => errors.push(`rejection: ${e.stack}`));

// --- Canvas stub (jsdom has no 2d context) -----------------------------------
const ctxStub = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'getBoundingClientRect') return () => ({ left: 0, top: 0, width: 1000, height: 700 });
    if (prop === 'canvas') return {};
    return (..._args) => ({ addColorStop() {}, });
  },
  set() { return true; },
});
window.HTMLCanvasElement.prototype.getContext = () => ctxStub;

// --- Boot the game -------------------------------------------------------------
await import(new URL('../public/js/main.js', import.meta.url).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  ✗ FAIL:', msg); } };
const section = (s) => console.log(`\n== ${s}`);
const G = () => window.EMBERWAKE;

section('boot');
await sleep(300);
ok(G(), 'EMBERWAKE debug hook present');
ok(!window.document.getElementById('intro').classList.contains('hidden'), 'intro overlay visible on fresh game');
ok(G().state.paused === true, 'game paused during intro');

section('intro skip');
window.document.querySelector('#in-next').click();
window.document.querySelector('#in-next').click();
ok(window.document.querySelector('#in-start'), 'final slide shows Begin button');
ok(window.document.querySelector('#in-daily'), 'final slide offers Today\u2019s Reach (daily shared seed)');
window.document.querySelector('#in-start').click(); // dismiss via Begin
await sleep(150);
ok(window.document.getElementById('intro').classList.contains('hidden'), 'intro dismissed');
ok(G().state.paused === false, 'game running after intro');
ok(window.document.getElementById('ticker'), 'world ticker present');

section('HUD & market');
await sleep(1000);
const credits = window.document.getElementById('tb-credits-v').textContent;
ok(credits !== '—' && credits.length > 0, `HUD credits rendered ("${credits}")`);
const rows = window.document.querySelectorAll('#p-market .mk-row');
ok(rows.length >= 4, `market rows rendered (${rows.length})`);
const locEl = window.document.getElementById('tb-loc').textContent;
ok(locEl.length > 2, `location shown: "${locEl}"`);

section('buying cargo');
const buyBtn = window.document.querySelector('#p-market [data-act="buy"]');
ok(buyBtn, 'buy button exists');
buyBtn.click();
await sleep(120);
const cargo = G().state.player.cargo;
ok(Object.values(cargo).reduce((a, b) => a + b, 0) > 0, `cargo after buy: ${JSON.stringify(cargo)}`);
ok(G().state.player.flags.tutorialBuy === true, 'tutorial buy flag set');

section('milestone widget');
ok(window.document.getElementById('milestone-widget').textContent.includes('Milestone'), 'milestone widget visible');
await sleep(1200); // milestone checks run per tick (800ms at 1×)
ok(G().state.milestones.idx >= 1, 'milestone #1 (stock the hold) completed');

section('route + travel');
const state = G().state;
const start = state.player.mooring;
const edge = state.edges.find((e) => e.a === start || e.b === start);
const dest = edge.a === start ? edge.b : edge.a;
G().selectMooring(dest);
await sleep(120);
const card = window.document.getElementById('mooring-card');
ok(!card.classList.contains('hidden'), 'mooring card opened');
ok(card.innerHTML.includes('Set course'), 'travel button offered');
const travelBtn = card.querySelector('[data-act="travel"]');
ok(travelBtn && !travelBtn.disabled, 'travel enabled');
travelBtn.click();
await sleep(120);
ok(state.player.phase === 'travel', 'phase=travel after departure');
ok(state.player.fuel < 30, 'fuel consumed');

// Fast-forward to arrival.
state.speed = 4;
let waited = 0;
while (state.player.phase === 'travel' && waited < 30000) {
  if (state.pendingEncounter) {
    // Resolve any encounter with its first choice, like a cautious captain.
    const btn = window.document.querySelector('#modal-root .m-buttons .btn');
    if (btn) btn.click();
    await sleep(80);
    const cont = window.document.querySelector('#modal-root .m-buttons .btn.primary');
    if (cont) cont.click();
    await sleep(80);
  }
  await sleep(200);
  waited += 200;
}
ok(state.player.phase === 'dock', `arrived (phase=${state.player.phase}, waited=${waited}ms)`);
ok(state.player.mooring === dest, `docked at destination (${state.player.mooring} vs ${dest})`);
ok(state.player.stats.visited.includes(dest), 'destination marked visited');

section('selling cargo');
await sleep(900); // panel refresh cadence
const sellBtn = window.document.querySelector('#p-market [data-act="sell"]:not([disabled])');
if (sellBtn) {
  const creditsBefore = state.player.credits;
  sellBtn.click();
  await sleep(120);
  ok(state.player.credits >= creditsBefore, `sell paid out (${creditsBefore} → ${state.player.credits})`);
} else {
  ok(Object.keys(state.player.cargo).length === 0, 'no enabled sell button only if cargo empty');
}

section('codex rivals');
G().setTab('codex');
await sleep(60);
ok(window.document.getElementById('p-codex').innerHTML.includes('Captains of the Reach'), 'rival leaderboard rendered');

section('all tabs render');
for (const tab of ['ship', 'contracts', 'factions', 'codex', 'log', 'market']) {
  G().setTab(tab);
  await sleep(60);
  const panel = window.document.getElementById(`p-${tab}`);
  ok(panel && panel.innerHTML.length > 100, `tab ${tab} rendered (${panel?.innerHTML.length || 0} chars)`);
}

section('contracts board');
G().setTab('contracts');
await sleep(80);
const offers = state.contracts.offers;
ok(offers.length > 0, `contract offers exist (${offers.length})`);
const signBtn = window.document.querySelector('#p-contracts [data-act="accept"]:not([disabled])');
if (signBtn) {
  signBtn.click();
  await sleep(80);
  ok(state.contracts.active.length === 1, 'contract signed');
} else {
  ok(true, 'no signable offer from this mooring (acceptable)');
}

section('ship services');
G().setTab('ship');
await sleep(80);
ok(window.document.getElementById('p-ship').innerHTML.includes('The Emberwake'), 'ship panel shows vessel');
ok(window.document.getElementById('p-ship').innerHTML.includes('Crew'), 'crew section rendered');
ok(window.document.getElementById('p-ship').innerHTML.includes('Underwriters'), 'insurance section rendered');

section('market filters');
G().setTab('market');
await sleep(60);
ok(window.document.querySelectorAll('#p-market .fchip').length === 3, 'market filter chips rendered');
window.document.querySelector('#p-market .fchip[data-f="scarce"]').click();
await sleep(60);
ok(true, 'scarce filter click handled without error');
window.document.querySelector('#p-market .fchip[data-f="all"]').click();
await sleep(60);

section('persistence');
G().saveNow();
ok(window.localStorage.getItem('emberwake.save.v3'), 'save written');
const parsed = JSON.parse(window.localStorage.getItem('emberwake.save.v3'));
ok(parsed.v === 3 && parsed.moorings.length === 34, 'save structurally valid');

section('speed controls');
window.document.querySelector('#tb-speed button[data-speed="0"]').click();
ok(state.paused === true, 'pause button pauses');
window.document.querySelector('#tb-speed button[data-speed="1"]').click();
ok(state.paused === false && state.speed === 1, 'resume works');

console.log(errors.length ? `\n⚠ runtime errors captured:\n${errors.join('\n')}` : '\n(no runtime errors captured)');
ok(errors.length === 0, 'no runtime errors');

console.log(failures === 0 ? '\n✅ BROWSER SMOKE TEST PASSED' : `\n❌ ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
