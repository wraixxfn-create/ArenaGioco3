// Modals, toasts, tooltips, intro — the game's voice.

import { esc } from '../core/util.js';
import { sfx } from '../audio/audio.js';

// --- Toasts ------------------------------------------------------------------

export function toast(html, kind = 'info', timeout = 4600) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  root.appendChild(el);
  while (root.children.length > 4) root.firstChild.remove();
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, timeout);
}

export function vexSay(text) {
  toast(`<span class="who">Quartermaster Vex</span>${esc(text)}`, 'vex', 6500);
}

// --- Modal -------------------------------------------------------------------

let modalEl = null;

export function closeModal() {
  if (modalEl) { modalEl.remove(); modalEl = null; }
  const root = document.getElementById('modal-root');
  root.classList.add('hidden');
  root.innerHTML = '';
}

export function modal({ title, icon, html, buttons = [], dismissable = true, onClose }) {
  const root = document.getElementById('modal-root');
  closeModal();
  root.classList.remove('hidden');

  const back = document.createElement('div');
  back.className = 'modal-backdrop';
  const box = document.createElement('div');
  box.className = 'modal';
  box.innerHTML = `
    ${dismissable ? '<button class="m-x" aria-label="close">✕</button>' : ''}
    ${icon ? `<div class="m-icon">${icon}</div>` : ''}
    <h3>${esc(title)}</h3>
    <div class="m-body">${html}</div>
    <div class="m-buttons"></div>`;
  const btnWrap = box.querySelector('.m-buttons');
  const close = () => { closeModal(); onClose?.(); };

  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = `btn ${b.cls || ''}`;
    btn.innerHTML = `${esc(b.label)}${b.hint ? `<span class="hint">${esc(b.hint)}</span>` : ''}`;
    if (b.disabled) btn.disabled = true;
    btn.addEventListener('click', () => {
      sfx.click();
      if (b.keepOpen) { b.onClick?.(btn); return; }
      const keep = b.onClick?.() === false;
      if (!keep) close();
    });
    btnWrap.appendChild(btn);
  }
  if (dismissable) {
    box.querySelector('.m-x')?.addEventListener('click', close);
    back.addEventListener('click', close);
  }
  root.append(back, box);
  modalEl = root;
  return { close };
}

// Result line helper for encounter-style modals.
export function showResultInModal(box, text) {
  const body = box.querySelector('.m-body');
  if (!body) return;
  let r = document.createElement('div');
  r.className = 'm-result';
  r.textContent = text;
  body.appendChild(r);
}

// --- Tooltip -----------------------------------------------------------------

const tipEl = () => document.getElementById('tooltip');

export function bindTooltips() {
  const tip = tipEl();
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.classList.remove('show'); return; }
    tip.textContent = t.getAttribute('data-tip');
    tip.classList.add('show');
    positionTip(e);
  });
  document.addEventListener('mousemove', (e) => {
    if (tip.classList.contains('show')) positionTip(e);
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-tip]')) tip.classList.remove('show');
  });
}

function positionTip(e) {
  const tip = tipEl();
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  const r = tip.getBoundingClientRect();
  if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

// --- Intro -------------------------------------------------------------------

const INTRO_SLIDES = [
  `<p>The world broke long ago. What remains floats — <b>moorings</b> anchored in a sea of
   cloud, ruled by five factions who trade, scheme, and occasionally burn each other's lanes.</p>
   <p>You own one skyship, a modest hold, and 1,200 gilds. Around the Reach, the storm-wall
   called <b>the Shroud</b> is slowly waking up.</p>
   <p>Nobody chose you. That is the point.</p>`,
  `<p><b>The loop:</b> buy where goods are plentiful, sail, sell where they are scarce.
   Every crate you move changes the prices behind you — the economy is real, and so is everyone else trading in it.</p>
   <p><b>Watch three things:</b> your <b>embers</b> (fuel — every leg burns them), your
   <b>reputation</b> (it unlocks licenses, contracts and prices), and the <b>lane conditions</b>
   (storms and wars make routes dangerous — and profitable).</p>`,
  `<p><b>Controls:</b> click moorings to travel, use the tabs on the right for markets and ledgers,
   and own time itself with ⏸/1×/2×/4× (spacebar pauses).</p>
   <p>The world keeps turning while you plan — contracts expire, wars start, harvests boom.
   Your ledger autosaves. The Reach will remember you.</p>`,
];

export function showIntro(onDone) {
  const el = document.getElementById('intro');
  let idx = 0;
  el.classList.remove('hidden');
  const render = () => {
    el.innerHTML = `
      <div class="intro-box">
        <div class="title">EMBERWAKE</div>
        <div class="subtitle">Skyship Ledger of the Shattered Reach</div>
        <div class="dots">${INTRO_SLIDES.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')}</div>
        <div class="slide">${INTRO_SLIDES[idx]}</div>
        <div class="nav">
          ${idx > 0 ? '<button class="btn" id="in-back">‹ Back</button>' : '<button class="btn" id="in-skip">Skip</button>'}
          ${idx < INTRO_SLIDES.length - 1
            ? '<button class="btn primary" id="in-next">Next ›</button>'
            : '<button class="btn primary" id="in-start">⚓ Begin the First Tide</button>'}
        </div>
      </div>`;
    el.querySelector('#in-next')?.addEventListener('click', () => { sfx.click(); idx++; render(); });
    el.querySelector('#in-back')?.addEventListener('click', () => { sfx.click(); idx--; render(); });
    el.querySelector('#in-skip')?.addEventListener('click', done);
    el.querySelector('#in-start')?.addEventListener('click', done);
  };
  const done = () => { sfx.dock(); el.classList.add('hidden'); onDone?.(); };
  render();
}
