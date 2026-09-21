// Canvas map: the Shattered Reach. Pan/zoom, faction-colored moorings,
// storms, wars, NPC caravans, anomalies, and the player's ship with a trail.

import { WORLD_W, WORLD_H } from '../world/gen.js';
import { FACTION_MAP } from '../data/factions.js';
import { isStormed, warOnEdge } from '../sim/economy.js';

let canvas, ctx, getState, hooks;
let view = { x: WORLD_W / 2, y: WORLD_H / 2, scale: 1 };
let W = 0, H = 0, dpr = 1;
let embers = [];
let clouds = [];
let trail = [];
let pulses = []; // {mooringId, color, t0}
let hover = null; // {kind:'mooring'|'anomaly', id}
let dragging = false, dragMoved = 0, lastMouse = null;
let dashPhase = 0;

// Called from main on world events — rings a mooring on the map.
export function addPulse(mooringId, color = '#ffd75e') {
  pulses.push({ mooringId, color, t0: performance.now() });
  if (pulses.length > 12) pulses.shift();
}

// Deterministic per-mooring variation (island shapes, bob phase).
function mHash(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export function initMap(opts) {
  canvas = opts.canvas;
  ctx = canvas.getContext('2d');
  getState = opts.getState;
  hooks = opts;
  resize();
  window.addEventListener('resize', resize);
  fitView();
  seedEmbers();
  bindInput();
  document.getElementById('zoom-in')?.addEventListener('click', () => zoomBy(1.28));
  document.getElementById('zoom-out')?.addEventListener('click', () => zoomBy(0.78));
  document.getElementById('zoom-fit')?.addEventListener('click', () => fitView());
  requestAnimationFrame(frame);
}

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = rect.width; H = rect.height;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
}

export function fitView() {
  const s = Math.min(W / WORLD_W, H / WORLD_H) * 0.94;
  view.scale = Math.max(0.35, s);
  view.x = WORLD_W / 2;
  view.y = WORLD_H / 2;
}

export function zoomBy(f) {
  const ns = clampScale(view.scale * f);
  view.scale = ns;
}

function clampScale(s) {
  const base = Math.min(W / WORLD_W, H / WORLD_H);
  return Math.max(base * 0.55, Math.min(base * 3.2, s));
}

function seedEmbers() {
  embers = [];
  for (let i = 0; i < 90; i++) {
    embers.push({
      x: Math.random() * 2000, y: Math.random() * 1200,
      vx: 0.08 + Math.random() * 0.22, vy: -(0.02 + Math.random() * 0.1),
      r: 0.6 + Math.random() * 1.7, a: 0.12 + Math.random() * 0.4,
      hue: Math.random() < 0.8 ? '232,180,90' : '79,216,200',
    });
  }
  clouds = [];
  for (let i = 0; i < 16; i++) {
    clouds.push({
      x: Math.random() * (WORLD_W + 400) - 200,
      y: 60 + Math.random() * (WORLD_H - 120),
      w: 90 + Math.random() * 180,
      h: 22 + Math.random() * 34,
      v: 0.05 + Math.random() * 0.12,
      a: 0.035 + Math.random() * 0.055,
    });
  }
}

const w2sX = (x) => (x - view.x) * view.scale + W / 2;
const w2sY = (y) => (y - view.y) * view.scale + H / 2;
const s2wX = (x) => (x - W / 2) / view.scale + view.x;
const s2wY = (y) => (y - H / 2) / view.scale + view.y;

// --- Input ------------------------------------------------------------------

function bindInput() {
  canvas.addEventListener('mousedown', (e) => {
    dragging = true; dragMoved = 0;
    lastMouse = { x: e.clientX, y: e.clientY };
    canvas.classList.add('dragging');
  });
  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    if (dragging && lastMouse) {
      const dx = e.clientX - lastMouse.x, dy = e.clientY - lastMouse.y;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      view.x -= dx / view.scale;
      view.y -= dy / view.scale;
      lastMouse = { x: e.clientX, y: e.clientY };
    } else if (mx >= 0 && my >= 0 && mx <= W && my <= H) {
      updateHover(mx, my);
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove('dragging');
    if (dragMoved < 6) {
      const rect = canvas.getBoundingClientRect();
      handleClick(e.clientX - rect.left, e.clientY - rect.top);
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const wx = s2wX(mx), wy = s2wY(my);
    const f = e.deltaY < 0 ? 1.12 : 0.89;
    view.scale = clampScale(view.scale * f);
    view.x = wx - (mx - W / 2) / view.scale;
    view.y = wy - (my - H / 2) / view.scale;
  }, { passive: false });

  // Touch: pan + tap + pinch zoom.
  let touchStart = null;
  let pinch = null;
  const touchDist = (e) => Math.hypot(
    e.touches[0].clientX - e.touches[1].clientX,
    e.touches[0].clientY - e.touches[1].clientY,
  );
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinch = { d: touchDist(e), scale: view.scale };
      touchStart = null;
    } else if (e.touches.length === 1) {
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: 0 };
      lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      view.scale = clampScale(pinch.scale * (touchDist(e) / pinch.d));
    } else if (e.touches.length === 1 && lastMouse) {
      const dx = e.touches[0].clientX - lastMouse.x, dy = e.touches[0].clientY - lastMouse.y;
      touchStart && (touchStart.moved += Math.abs(dx) + Math.abs(dy));
      view.x -= dx / view.scale;
      view.y -= dy / view.scale;
      lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, { passive: true });
  canvas.addEventListener('touchend', (e) => {
    pinch = null;
    if (touchStart && touchStart.moved < 12) {
      const rect = canvas.getBoundingClientRect();
      const t = e.changedTouches[0];
      handleClick(t.clientX - rect.left, t.clientY - rect.top);
    }
    touchStart = null; lastMouse = null;
  });
}

function updateHover(mx, my) {
  const state = getState();
  const wx = s2wX(mx), wy = s2wY(my);
  hover = null;
  let best = 20 / view.scale;
  for (const m of state.moorings) {
    const d = Math.hypot(m.x - wx, m.y - wy);
    if (d < best + nodeRadius(m)) { best = d; hover = { kind: 'mooring', id: m.id }; }
  }
  if (!hover) {
    for (const a of state.anomalies) {
      if (!a.salvaged && Math.hypot(a.x - wx, a.y - wy) < 14) hover = { kind: 'anomaly', id: a.id };
    }
  }
  canvas.classList.toggle('hoverable', !!hover);
  const tip = document.getElementById('tooltip');
  if (hover && tip) {
    if (hover.kind === 'mooring') {
      const m = state.byId[hover.id];
      const fac = FACTION_MAP[m.faction];
      tip.innerHTML = `<b style="color:${fac.color}">${m.name}</b><br>${fac.name}${m.shipyard ? ' · ⚓ shipyard' : ''}${m.hq ? ' · HQ' : ''}${m.visited ? '' : '<br><span style="color:#6d675c">uncharted</span>'}`;
    } else {
      tip.textContent = 'Anomaly — dock at the nearby mooring and scan it (needs Scanner L1).';
    }
    tip.classList.add('show');
    tip.style.left = `${mx + canvas.getBoundingClientRect().left + 16}px`;
    tip.style.top = `${my + canvas.getBoundingClientRect().top + 16}px`;
  } else if (tip) {
    tip.classList.remove('show');
  }
}

function handleClick(mx, my) {
  const state = getState();
  const wx = s2wX(mx), wy = s2wY(my);
  for (const m of state.moorings) {
    if (Math.hypot(m.x - wx, m.y - wy) < 20 / view.scale + nodeRadius(m)) {
      hooks.onSelect?.(m.id);
      return;
    }
  }
  for (const a of state.anomalies) {
    if (!a.salvaged && Math.hypot(a.x - wx, a.y - wy) < 16 / view.scale + 8) {
      hooks.onAnomaly?.(a.id);
      return;
    }
  }
  hooks.onSelect?.(null);
}

function nodeRadius(m) {
  return 5.5 + Math.min(7, m.pop / 130);
}

// --- Rendering ----------------------------------------------------------------

function frame(now) {
  dashPhase = (now / 60) % 1000;
  draw(now);
  requestAnimationFrame(frame);
}

function draw(now) {
  const state = getState();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Sky: deep indigo with drifting nebula light.
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0a0f22');
  grad.addColorStop(0.55, '#070a14');
  grad.addColorStop(1, '#0b0d18');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  drawNebula(now);
  drawEmbers(now);

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(view.scale, view.scale);
  ctx.translate(-view.x, -view.y);

  drawTerritoryGlow(state);
  drawEdges(state, now);
  drawRoutePreview(state);
  drawClouds(now);
  drawCaravans(state);
  drawAnomalies(state, now);
  drawMoorings(state, now);
  drawPulses(state, now);
  drawPlayer(state, now);

  ctx.restore();

  drawVignette();
}

function drawNebula(now) {
  const t = now / 9000;
  const blobs = [
    { x: W * (0.25 + 0.06 * Math.sin(t)), y: H * 0.3, r: W * 0.4, c: '76, 60, 130' },
    { x: W * (0.75 + 0.05 * Math.cos(t * 0.8)), y: H * 0.7, r: W * 0.35, c: '34, 90, 96' },
    { x: W * 0.5, y: H * (0.85 + 0.04 * Math.sin(t * 1.3)), r: W * 0.3, c: '110, 70, 40' },
  ];
  for (const b of blobs) {
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
    g.addColorStop(0, `rgba(${b.c},0.10)`);
    g.addColorStop(1, `rgba(${b.c},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawVignette() {
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(2,3,8,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawClouds(now) {
  for (const c of clouds) {
    c.x += c.v;
    if (c.x - c.w > WORLD_W + 200) c.x = -c.w - 200;
    ctx.fillStyle = `rgba(190, 200, 220, ${c.a})`;
    for (let i = 0; i < 3; i++) {
      const ox = (i - 1) * c.w * 0.35;
      const oy = Math.sin(now / 4000 + c.x + i) * 3;
      ctx.beginPath();
      ctx.ellipse(c.x + ox, c.y + oy, c.w * (0.55 - Math.abs(i - 1) * 0.12), c.h, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawEmbers(now) {
  ctx.save();
  for (const p of embers) {
    p.x += p.vx; p.y += p.vy;
    if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
    if (p.x > W + 10) p.x = -10;
    const tw = 0.6 + 0.4 * Math.sin(now / 900 + p.x);
    ctx.fillStyle = `rgba(${p.hue},${(p.a * tw).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(p.x % W, ((p.y % H) + H) % H, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTerritoryGlow(state) {
  for (const m of state.moorings) {
    if (!m.hq) continue;
    const c = FACTION_MAP[m.faction].color;
    const g = ctx.createRadialGradient(m.x, m.y, 10, m.x, m.y, 150);
    g.addColorStop(0, c + '22');
    g.addColorStop(1, c + '00');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 150, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawEdges(state, now) {
  for (const e of state.edges) {
    const A = state.byId[e.a], B = state.byId[e.b];
    const stormed = isStormed(state, e);
    const war = warOnEdge(state, e);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    if (stormed) {
      // Base lane under fog.
      ctx.strokeStyle = 'rgba(150, 110, 220, 0.22)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // Rolling fog blobs along the lane.
      const len = Math.hypot(B.x - A.x, B.y - A.y);
      const blobs = Math.max(3, Math.floor(len / 45));
      for (let i = 0; i < blobs; i++) {
        const f = ((i / blobs) + (now / 9000)) % 1;
        const x = A.x + (B.x - A.x) * f;
        const y = A.y + (B.y - A.y) * f + Math.sin(now / 500 + i * 2.2) * 4;
        const r = 9 + 5 * Math.sin(now / 700 + i);
        ctx.fillStyle = 'rgba(140, 95, 215, 0.13)';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(4, r), 0, Math.PI * 2);
        ctx.fill();
      }
      // Occasional flicker of stormlight.
      if (Math.sin(now / 260 + e.len * 7) > 0.985) {
        ctx.strokeStyle = 'rgba(220, 200, 255, 0.5)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    } else if (war) {
      ctx.strokeStyle = `rgba(255, 93, 108, ${0.35 + 0.15 * Math.sin(now / 300)})`;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(210, 200, 180, 0.13)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

function drawRoutePreview(state) {
  const route = state.ui.routePreview;
  if (!route?.path?.length) return;
  ctx.beginPath();
  const first = state.byId[route.path[0]];
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < route.path.length; i++) {
    const n = state.byId[route.path[i]];
    if (n) ctx.lineTo(n.x, n.y);
  }
  ctx.strokeStyle = 'rgba(232, 180, 90, 0.75)';
  ctx.lineWidth = 2.2;
  ctx.setLineDash([9, 7]);
  ctx.lineDashOffset = -dashPhase;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCaravans(state) {
  for (const cv of state.caravans) {
    const A = state.byId[cv.a], B = state.byId[cv.b];
    const span = Math.max(1, cv.tArrive - cv.t0);
    const f = Math.max(0, Math.min(1, (state.t - cv.t0) / span));
    const x = A.x + (B.x - A.x) * f;
    const y = A.y + (B.y - A.y) * f;
    ctx.fillStyle = 'rgba(233, 228, 214, 0.6)';
    ctx.beginPath();
    ctx.arc(x, y, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawAnomalies(state, now) {
  for (const a of state.anomalies) {
    if (a.salvaged) continue;
    const pulse = 0.75 + 0.25 * Math.sin(now / 420 + a.x);
    const r = 7 * pulse;
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(now / 1400);
    ctx.strokeStyle = `rgba(79, 216, 200, ${0.8 * pulse})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    if (a.scanLeft > 0) {
      ctx.strokeStyle = 'rgba(79, 216, 200, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - a.scanLeft / 2));
      ctx.stroke();
    }
  }
}

function drawMoorings(state, now) {
  const p = state.player;
  const showLabels = view.scale > 0.55;
  for (const m of state.moorings) {
    const r = nodeRadius(m);
    const fac = FACTION_MAP[m.faction];
    const isSel = state.ui.selected === m.id;
    const isHome = p.mooring === m.id && p.phase === 'dock';
    const h = mHash(m.id);
    const bob = Math.sin(now / 1400 + (h % 100) / 10) * 1.6;
    const x = m.x, y = m.y + bob;
    const lit = m.visited;
    const rioting = m.riotUntil > state.t;

    if (isHome) {
      const g = ctx.createRadialGradient(x, y, 2, x, y, r * 3.6);
      g.addColorStop(0, 'rgba(232,180,90,0.32)');
      g.addColorStop(1, 'rgba(232,180,90,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 3.6, 0, Math.PI * 2); ctx.fill();
    }

    drawIsland(m, x, y, r, h, lit, rioting, fac, now);

    // Faction ring around the island.
    ctx.beginPath();
    ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = lit ? fac.color + 'cc' : 'rgba(160,154,140,0.22)';
    ctx.lineWidth = m.hq ? 2 : 1.3;
    ctx.stroke();
    if (m.hq) {
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, Math.PI * 2);
      ctx.strokeStyle = fac.color + '55';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Selection ring.
    if (isSel) {
      ctx.beginPath();
      ctx.arc(x, y, r + 9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232,180,90,0.9)';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -dashPhase * 0.8;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Label.
    const known = m.visited || m.hq;
    if (showLabels && (known || isSel) && view.scale > (m.hq ? 0.35 : 0.5)) {
      ctx.font = `${m.hq ? '600 12px' : '11px'} system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = known ? 'rgba(233,228,214,0.88)' : 'rgba(233,228,214,0.35)';
      ctx.fillText(known ? m.name : '?', x, y + r + 16);
      if (lit && rioting) {
        ctx.fillStyle = 'rgba(255,107,118,0.9)';
        ctx.font = '9px system-ui, sans-serif';
        ctx.fillText('riots', x, y + r + 26);
      }
    }
  }
}

// A mooring is a floating island: rock hull, deck, structures, pennant, anchor chain.
function drawIsland(m, x, y, r, h, lit, rioting, fac, now) {
  const rockW = r * 2.3, rockH = r * 1.15;

  // Anchor chain + weight below.
  ctx.strokeStyle = lit ? 'rgba(200,190,170,0.28)' : 'rgba(200,190,170,0.12)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(x, y + rockH * 0.7);
  ctx.lineTo(x + Math.sin(now / 2000 + h) * 1.2, y + rockH * 0.7 + r + 7);
  ctx.stroke();
  ctx.fillStyle = lit ? 'rgba(200,190,170,0.35)' : 'rgba(200,190,170,0.15)';
  ctx.beginPath();
  ctx.arc(x + Math.sin(now / 2000 + h) * 1.2, y + rockH * 0.7 + r + 8, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // Rock hull (jagged, seeded shape).
  ctx.beginPath();
  const pts = 9;
  for (let i = 0; i <= pts; i++) {
    const a = Math.PI * (i / pts); // lower half only
    const jag = 0.82 + ((h >> (i % 24)) & 3) * 0.09;
    const px = x - Math.cos(a) * rockW * jag * 0.5;
    const py = y + Math.sin(a) * rockH * jag;
    if (i === 0) ctx.moveTo(px, y); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = lit ? (rioting ? '#33202a' : '#232c4a') : '#12161f';
  ctx.fill();
  ctx.strokeStyle = lit ? 'rgba(232,180,90,0.18)' : 'rgba(160,154,140,0.12)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Deck (top ellipse).
  ctx.beginPath();
  ctx.ellipse(x, y, rockW * 0.5, rockH * 0.34, 0, 0, Math.PI * 2);
  ctx.fillStyle = lit ? (rioting ? '#402832' : '#2e3a60') : '#161b26';
  ctx.fill();

  // Structures: more population → more rooftops; HQ gets a spire.
  if (lit) {
    const n = Math.min(5, 1 + Math.floor(m.pop / 220));
    for (let i = 0; i < n; i++) {
      const bx = x + ((h >> (i * 3)) % 7 - 3) * r * 0.22;
      const bh = 2.5 + ((h >> (i * 5)) % 4);
      ctx.fillStyle = rioting ? '#57323d' : '#3f4d7a';
      ctx.fillRect(bx - 1.3, y - rockH * 0.3 - bh, 2.6, bh);
      // Window light.
      ctx.fillStyle = rioting ? 'rgba(255,107,118,0.85)' : 'rgba(255, 216, 138, 0.8)';
      ctx.fillRect(bx - 0.5, y - rockH * 0.3 - bh + 1, 1, 1);
    }
    if (m.hq) {
      ctx.fillStyle = fac.color;
      ctx.beginPath();
      ctx.moveTo(x, y - rockH * 0.3 - 12);
      ctx.lineTo(x - 2.4, y - rockH * 0.3);
      ctx.lineTo(x + 2.4, y - rockH * 0.3);
      ctx.closePath();
      ctx.fill();
    }
    // Pennant flag.
    ctx.strokeStyle = 'rgba(220,210,190,0.5)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(x + rockW * 0.28, y - rockH * 0.25);
    ctx.lineTo(x + rockW * 0.28, y - rockH * 0.25 - 7);
    ctx.stroke();
    ctx.fillStyle = fac.color;
    const flutter = Math.sin(now / 300 + h) * 1.2;
    ctx.beginPath();
    ctx.moveTo(x + rockW * 0.28, y - rockH * 0.25 - 7);
    ctx.lineTo(x + rockW * 0.28 + 5, y - rockH * 0.25 - 6 + flutter * 0.4);
    ctx.lineTo(x + rockW * 0.28, y - rockH * 0.25 - 4.5);
    ctx.closePath();
    ctx.fill();
    // Shipyard crane.
    if (m.shipyard) {
      ctx.strokeStyle = 'rgba(232,180,90,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - rockW * 0.34, y - rockH * 0.2);
      ctx.lineTo(x - rockW * 0.34, y - rockH * 0.2 - 8);
      ctx.lineTo(x - rockW * 0.34 + 5, y - rockH * 0.2 - 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - rockW * 0.34 + 4, y - rockH * 0.2 - 8);
      ctx.lineTo(x - rockW * 0.34 + 4, y - rockH * 0.2 - 4);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = 'rgba(233,228,214,0.3)';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('?', x, y - rockH * 0.25);
  }
}

function drawPulses(state, now) {
  pulses = pulses.filter((p) => now - p.t0 < 1800);
  for (const p of pulses) {
    const m = state.byId[p.mooringId];
    if (!m) continue;
    const age = (now - p.t0) / 1800;
    const r = nodeRadius(m) + 6 + age * 34;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = (1 - age) * 0.75;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawPlayer(state, now) {
  const p = state.player;
  let x, y, ang = 0;
  if (p.phase === 'travel' && p.travel) {
    const e = state.edges.find((ed) => ed.id === p.travel.edgeId);
    const A = state.byId[e.a], B = state.byId[e.b];
    const from = p.travel.from === e.a ? A : B;
    const to = p.travel.from === e.a ? B : A;
    const f = Math.max(0, Math.min(1, p.travel.t / p.travel.dur));
    const ease = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
    x = from.x + (to.x - from.x) * ease;
    y = from.y + (to.y - from.y) * ease;
    ang = Math.atan2(to.y - from.y, to.x - from.x);
    trail.push({ x, y, t: now });
  } else {
    const m = state.byId[p.mooring];
    const bob = Math.sin(now / 700) * 2;
    x = m.x + 14; y = m.y - 12 + bob;
    ang = -Math.PI / 4;
    trail.length = 0;
  }
  // Trail.
  for (let i = 0; i < trail.length; i++) {
    const tp = trail[i];
    const age = (now - tp.t) / 900;
    if (age > 1) continue;
    ctx.fillStyle = `rgba(232,180,90,${(0.35 * (1 - age)).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, 2.2 * (1 - age), 0, Math.PI * 2);
    ctx.fill();
  }
  if (trail.length > 40) trail.splice(0, trail.length - 40);

  drawAirship(x, y, ang, p.phase === 'travel', now);
}

// The Emberwake: gas envelope, gondola, fins — and a flame when she runs.
function drawAirship(x, y, ang, underway, now) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);

  ctx.shadowColor = 'rgba(232,180,90,0.75)';
  ctx.shadowBlur = 10;

  // Envelope.
  const eg = ctx.createLinearGradient(0, -4.5, 0, 2);
  eg.addColorStop(0, '#f4d291');
  eg.addColorStop(0.6, '#cf9d4e');
  eg.addColorStop(1, '#8a6428');
  ctx.fillStyle = eg;
  ctx.beginPath();
  ctx.ellipse(0, -2.2, 8.2, 3.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(60,40,10,0.5)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.ellipse(0, -2.2, 8.2, 3.4, 0, 0, Math.PI * 2);
  ctx.stroke();
  // Envelope seams.
  ctx.beginPath();
  ctx.moveTo(-8, -2.2); ctx.lineTo(8, -2.2);
  ctx.strokeStyle = 'rgba(60,40,10,0.25)';
  ctx.stroke();

  // Fins.
  ctx.fillStyle = '#b3843c';
  ctx.beginPath();
  ctx.moveTo(-8.2, -2.2); ctx.lineTo(-11.5, -4.6); ctx.lineTo(-9.5, -1.8);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-8.2, -2.2); ctx.lineTo(-11.5, 0.2); ctx.lineTo(-9.5, -2.4);
  ctx.closePath(); ctx.fill();

  // Rigging.
  ctx.strokeStyle = 'rgba(220,210,190,0.55)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(-3, 0.6); ctx.lineTo(-2, 2.6);
  ctx.moveTo(3, 0.6); ctx.lineTo(2, 2.6);
  ctx.stroke();

  // Gondola.
  ctx.fillStyle = '#5a4423';
  ctx.beginPath();
  ctx.moveTo(-3.6, 2.6); ctx.lineTo(4.2, 2.6); ctx.lineTo(3.2, 4.6); ctx.lineTo(-2.8, 4.6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,216,138,0.95)';
  ctx.fillRect(0.2, 3, 1.1, 1.1);
  ctx.fillRect(-1.8, 3, 1.1, 1.1);

  // Stern flame when underway.
  if (underway) {
    const flick = 0.7 + 0.5 * Math.abs(Math.sin(now / 60));
    ctx.fillStyle = `rgba(255, 176, 64, ${0.75 * flick})`;
    ctx.beginPath();
    ctx.moveTo(-9.5, -2.2);
    ctx.lineTo(-13 - flick * 3, -2.2 + Math.sin(now / 50) * 0.7);
    ctx.lineTo(-9.5, -1.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(255, 232, 180, ${0.7 * flick})`;
    ctx.beginPath();
    ctx.arc(-9.6, -2, 1, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
