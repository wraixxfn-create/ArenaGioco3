// Versioned persistence. localStorage with graceful degradation;
// offline catch-up is computed by the caller via sim.runOffline.

const KEY = 'emberwake.save.v3';

export function saveGame(state) {
  try {
    const snapshot = { ...state, pendingEncounter: null, savedAt: Date.now() };
    const json = JSON.stringify(snapshot, (k, v) => (k.startsWith('_') ? undefined : v));
    localStorage.setItem(KEY, json);
    return true;
  } catch (err) {
    console.warn('Save failed:', err);
    return false;
  }
}

export function loadGame() {
  try {
    const json = localStorage.getItem(KEY);
    if (!json) return null;
    const state = JSON.parse(json);
    if (!state || state.v !== 3) return null;
    // Rebuild derived indices.
    state.byId = Object.fromEntries(state.moorings.map((m) => [m.id, m]));
    state.pendingEncounter = null;
    state.ui = state.ui || { tab: 'market', selected: state.player.mooring };
    // Forward-compat: fields introduced after a save was written.
    state.player.investments = state.player.investments || {};
    state.player.crew = state.player.crew || [];
    state.player.stats.dividends = state.player.stats.dividends || 0;
    state.player.stats.sharesBought = state.player.stats.sharesBought || 0;
    state.rivals = state.rivals || [];
    return state;
  } catch (err) {
    console.warn('Load failed:', err);
    return null;
  }
}

export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function saveMeta() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return { savedAt: s.savedAt || s.meta?.createdAt || Date.now(), seed: s.meta?.seed, era: s.meta?.era };
  } catch { return null; }
}
