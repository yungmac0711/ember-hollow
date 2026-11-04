// Shared `when` filter + placeholder fill for the writer's data (story/DATA_FORMATS.md):
// AND across keys; a string/bool/number value means equality, an array means any-of; a key missing
// from the state never matches. `area: "cave"` matches any underground chamber. `dayCountMin` is a
// number that matches when dayCount ≥ N (sleep_lines).
import { CONFIG } from '../config.js';

const UNDERGROUND = new Set(['lanternmouth', 'flintseam', 'glowcap', 'mossdrip', 'hushing', 'glowmere']);

function matchOne(key, want, state) {
  if (key === 'dayCountMin') return typeof state.dayCount === 'number' && state.dayCount >= want;
  if (!(key in state) || state[key] === undefined || state[key] === null) return false;
  const have = state[key];
  const eq = (w) => (key === 'area' && w === 'cave' ? UNDERGROUND.has(have) : w === have);
  return Array.isArray(want) ? want.some(eq) : eq(want);
}

/** Number of keys matched (all must match), or -1 if the filter fails. No filter → 0. */
export function matchWhen(when, state) {
  if (!when) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(when)) { if (!matchOne(k, v, state)) return -1; n++; }
  return n;
}

/** {{player}}, {{biscuit}}, {{area}} (display name), {{dayCount}}. */
export function fill(text, state = {}) {
  return text
    .replace(/\{\{player\}\}/g, state.playerName || CONFIG.playerName || 'Cam')
    .replace(/\{\{biscuit\}\}/g, CONFIG.puppy?.name || 'Biscuit')
    .replace(/\{\{area\}\}/g, state.areaName || 'the Hollow')
    .replace(/\{\{dayCount\}\}/g, String(state.dayCount ?? 1));
}

/** Weighted random pick from [{weight?}] (weight defaults to 1). */
export function weighted(list, rng = Math.random) {
  const total = list.reduce((s, r) => s + (r.weight ?? 1), 0);
  let x = rng() * total;
  for (const r of list) { x -= r.weight ?? 1; if (x < 0) return r; }
  return list[list.length - 1];
}

/** Most-specific tier among lines whose `when` matches (DATA_FORMATS §1 step 4). */
export function bestTier(lines, state) {
  let best = -1, tier = [];
  for (const l of lines) {
    const n = matchWhen(l.when, state);
    if (n < 0) continue;
    if (n > best) { best = n; tier = [l]; } else if (n === best) tier.push(l);
  }
  return tier;
}
