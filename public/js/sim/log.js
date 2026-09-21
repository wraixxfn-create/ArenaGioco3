// Shared log helper (leaf module — sim, contracts and encounters all write here).

export function addLog(state, type, text) {
  state.log.unshift({ t: state.t, type, text });
  if (state.log.length > 140) state.log.length = 140;
}
