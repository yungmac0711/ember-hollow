// M2 chunk C: coziness score (story/data/coziness.json, DATA_FORMATS §12) for the place Cam is in.
// Scope: the enclosed shelter (connected roofed+walled floor cells with a door) around Cam, or, with
// no shelter, everything within 8 m of the nearest fire (hearth or campfire) within 8 m of Cam.
// Five capped categories; only the first 2 copies of a piece score (floor and stone_path excepted);
// placed keepsakes score as `keepsake`; lit / roaring fires in scope add the warmth bonus.
import { STORY } from '../data/story.js';
import { PIECES } from '../build/pieces.js';

const C = STORY.coziness;
export const TIERS = C.tiers;
/** build piece type → coziness id */
const COZY_ID = { bedroll: 'bed_roll', window: 'window_wall' };
const UNCAPPED_COPIES = new Set(['floor', 'stone_path']);
const POINTS = {}; // cozy id → [category, pts]
for (const [cat, def] of Object.entries(C.categories)) for (const [id, pts] of Object.entries(def.points || {})) POINTS[id] = [cat, pts];
export const HEARTH_RADIUS = 8;

export function tierIndex(score) { let i = 0; TIERS.forEach((t, k) => { if (score >= t.minScore) i = k; }); return i; }

/** → { scope: 'shelter'|'hearth'|'none', score, tier, cats: {cat: pts}, pieces: n } */
export function scoreCoziness({ pieces, fires, pos, enclosed, G, roaring = () => false }) {
  const key = (x, z) => `${Math.round(x / G)},${Math.round(z / G)}`;
  let scope = 'none', inScope = null;
  const here = key(pos.x, pos.z);
  if (enclosed.has(here)) {
    // the connected shelter around Cam
    const comp = new Set([here]), st = [here];
    while (st.length) {
      const [i, j] = st.pop().split(',').map(Number);
      for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { const k = `${a},${b}`; if (enclosed.has(k) && !comp.has(k)) { comp.add(k); st.push(k); } }
    }
    const e = 0.3; // edge pieces (walls, wall lamps) sit on the cell boundary
    inScope = (x, z) => comp.has(key(x, z)) || comp.has(key(x + e, z)) || comp.has(key(x - e, z)) || comp.has(key(x, z + e)) || comp.has(key(x, z - e));
    scope = 'shelter';
  } else {
    let f = null, fd = HEARTH_RADIUS;
    for (const q of fires) { const d = Math.hypot(q.pos.x - pos.x, q.pos.z - pos.z); if (d <= fd) { fd = d; f = q; } }
    if (f) { inScope = (x, z) => Math.hypot(x - f.pos.x, z - f.pos.z) <= HEARTH_RADIUS; scope = 'hearth'; }
  }
  const cats = Object.fromEntries(Object.keys(C.categories).map((k) => [k, 0]));
  if (!inScope) return { scope, score: 0, tier: 0, cats, pieces: 0 };
  const copies = {};
  let n = 0;
  const add = (id) => {
    const pt = POINTS[id]; if (!pt) return;
    copies[id] = (copies[id] || 0) + 1;
    if (copies[id] > 2 && !UNCAPPED_COPIES.has(id)) return;
    cats[pt[0]] += pt[1];
  };
  for (const p of pieces) {
    if (!inScope(p.x, p.z)) continue;
    n++;
    const id = COZY_ID[p.type] || p.type;
    add(POINTS[id] ? id : PIECES[p.type]?.keepsake ? 'keepsake' : id);
  }
  let bonus = 0;
  for (const f of fires) {
    if (!inScope(f.pos.x, f.pos.z)) continue;
    if (!f.hearth) add('campfire');
    if (f.lit) bonus = Math.max(bonus, roaring(f) ? C.categories.warmth.bonus.fireRoaring : C.categories.warmth.bonus.fireLit);
  }
  cats.warmth += bonus;
  let score = 0;
  for (const [k, def] of Object.entries(C.categories)) { cats[k] = Math.min(def.cap, cats[k]); score += cats[k]; }
  score = Math.round(score * 2) / 2;
  return { scope, score, tier: tierIndex(score), cats, pieces: n };
}
