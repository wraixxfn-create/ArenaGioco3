// Procedural WebAudio: every sound is synthesized — zero assets.
// Autoplay-safe: the context is created on the first user gesture.

let ctx = null;
let master = null;
let ambientNodes = null;
let enabled = true;
let ambientOn = true;
let volume = 0.5;

function ensure() {
  if (ctx) return true;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = volume * 0.5;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    return false;
  }
  return true;
}

export function initAudio() {
  if (!ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();
  if (ambientOn) startAmbient();
}

function blip({ freq = 440, dur = 0.08, type = 'sine', gain = 0.2, slide = 0, delay = 0 }) {
  if (!enabled || !ensure()) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}

function chord(freqs, dur, type = 'triangle', gain = 0.12, step = 0.07) {
  freqs.forEach((f, i) => blip({ freq: f, dur, type, gain, delay: i * step }));
}

export const sfx = {
  click: () => blip({ freq: 660, dur: 0.05, type: 'square', gain: 0.06 }),
  buy: () => { blip({ freq: 392, dur: 0.07, type: 'triangle' }); blip({ freq: 523, dur: 0.09, type: 'triangle', delay: 0.06 }); },
  sell: () => chord([659, 784, 988], 0.09, 'triangle', 0.1, 0.05),
  coin: () => chord([988, 1319], 0.08, 'sine', 0.12, 0.04),
  travel: () => blip({ freq: 220, dur: 0.25, type: 'sawtooth', gain: 0.05, slide: 110 }),
  dock: () => blip({ freq: 330, dur: 0.18, type: 'triangle', gain: 0.1, slide: 60 }),
  alert: () => { blip({ freq: 523, dur: 0.12, type: 'square', gain: 0.1 }); blip({ freq: 415, dur: 0.16, type: 'square', gain: 0.1, delay: 0.12 }); },
  war: () => chord([196, 185, 175], 0.3, 'sawtooth', 0.08, 0.14),
  treaty: () => chord([523, 659, 784], 0.16, 'triangle', 0.1, 0.09),
  event: () => chord([587, 740], 0.12, 'sine', 0.1, 0.08),
  artifact: () => chord([784, 988, 1175, 1568], 0.2, 'sine', 0.09, 0.09),
  upgrade: () => chord([330, 415, 494, 659], 0.12, 'triangle', 0.09, 0.06),
  damage: () => blip({ freq: 120, dur: 0.35, type: 'sawtooth', gain: 0.16, slide: -40 }),
  achieve: () => chord([659, 784, 988, 1319], 0.18, 'triangle', 0.11, 0.08),
  error: () => blip({ freq: 220, dur: 0.12, type: 'square', gain: 0.08, slide: -60 }),
};

export function startAmbient() {
  if (!enabled || !ensure() || ambientNodes) return;
  try {
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    o1.type = 'sine'; o1.frequency.value = 55;
    o2.type = 'sine'; o2.frequency.value = 82.5;
    g.gain.value = 0.018;
    lfo.frequency.value = 0.07;
    lfoG.gain.value = 0.008;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    o1.connect(g); o2.connect(g); g.connect(master);
    o1.start(); o2.start(); lfo.start();
    ambientNodes = { o1, o2, lfo, g };
  } catch { ambientNodes = null; }
}

export function stopAmbient() {
  if (!ambientNodes) return;
  try {
    ambientNodes.o1.stop(); ambientNodes.o2.stop(); ambientNodes.lfo.stop();
  } catch { /* ignore */ }
  ambientNodes = null;
}

export function configureAudio({ enabled: e, ambient, vol }) {
  if (e !== undefined) enabled = e;
  if (vol !== undefined) { volume = vol; if (master) master.gain.value = volume * 0.5; }
  if (ambient !== undefined) {
    ambientOn = ambient;
    if (ambientOn && ctx) startAmbient();
    if (!ambientOn) stopAmbient();
  }
  if (!enabled) stopAmbient();
}
