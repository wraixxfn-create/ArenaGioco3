// Deterministic RNG + math/format helpers. Pure — no DOM, no state.

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngInt = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
export const rngPick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const rngChance = (rng, p) => rng() < p;
export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

export function pickWeighted(rng, entries) {
  // entries: [ [value, weight], ... ]
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}

let uidCounter = 1;
export const uid = (prefix = 'id') => `${prefix}-${(uidCounter++).toString(36)}-${Date.now().toString(36).slice(-4)}`;

export function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtMoney(n) {
  const v = Math.round(n);
  const sign = v < 0 ? '−' : '';
  return `${sign}${Math.abs(v).toLocaleString('en-US')} g`;
}

export function fmtSigned(n, suffix = '') {
  const v = Math.round(n);
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toLocaleString('en-US')}${suffix}`;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function dayOf(t) { return Math.floor(t / 24) + 1; }
export function hourOf(t) { return t % 24; }
export function fmtDate(t) {
  return `Day ${dayOf(t)}, ${String(hourOf(t)).padStart(2, '0')}:00`;
}

export const SEASONS = ['Emberfall', 'Deepwake', 'Brightcalm', 'Stormveil'];
export const SEASON_LEN_DAYS = 30;
export function seasonOf(t) {
  return SEASONS[Math.floor((dayOf(t) - 1) / SEASON_LEN_DAYS) % SEASONS.length];
}

// "Today's Reach": everyone who plays on the same day shares one world.
export function dailySeed(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `daily-${y}-${m}-${d}`;
}
