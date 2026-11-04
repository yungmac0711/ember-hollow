// Save / load (Chunk B): versioned JSON in localStorage under `ember_hollow.save`.
// Wren's companion memory stays in its own key (`ember_hollow.companion_memory`) and is never
// touched here — New Game wipes the save, not what Wren remembers.
export const SAVE_KEY = 'ember_hollow.save';
export const SAVE_VERSION = 1;
const NEWGAME_FLAG = 'ember_hollow.newgame';

export function hasSave() {
  try { const s = readSave(); return !!s; } catch { return false; }
}

export function readSave() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const d = migrate(JSON.parse(raw));
    return d && d.v === SAVE_VERSION ? d : null;
  } catch (e) { console.warn('[save] unreadable save ignored', e); return null; }
}

/** Upgrade older shapes in place. (v1 is the first; M0/chunk-A had no save.) */
function migrate(d) {
  if (!d || typeof d !== 'object') return null;
  if (d.v === SAVE_VERSION) {
    // pre-rename safety: `shard` → `crystal_shard`
    for (const bag of [d.inventory, ...(d.pieces || []).map((p) => p.store).filter(Boolean)]) {
      if (bag && 'shard' in bag) { bag.crystal_shard = (bag.crystal_shard || 0) + bag.shard; delete bag.shard; }
    }
    return d;
  }
  return null;
}

export function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: SAVE_VERSION, savedAt: Date.now(), ...data }));
    return true;
  } catch (e) { console.warn('[save] write failed', e); return false; }
}

export function deleteSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* private mode */ } }

/** New Game: wipe the save, flag the next load as fresh, reload. */
export function newGameReload() {
  deleteSave();
  try { sessionStorage.setItem(NEWGAME_FLAG, '1'); } catch { /* ignore */ }
  location.reload();
}
export function consumeNewGameFlag() {
  try { const v = sessionStorage.getItem(NEWGAME_FLAG); sessionStorage.removeItem(NEWGAME_FLAG); return v === '1'; } catch { return false; }
}
