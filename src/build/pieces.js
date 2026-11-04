// Building catalogue (M1). Base pieces cost wood + stone. Geometry is the M1 art set (art/assets/
// build + props + decor + keepsakes); the hearth is a real campfire (FireSystem) and the table is a
// chunky primitive until art makes one. `icon` is a file in assets/icons/ (or an emoji).
//   slot: 'cell'    — floor tile, fills a 2 m grid cell
//         'edge'    — wall-like, sits on a cell edge (walls, window wall, door)
//         'roof'    — over a cell at wall height; needs a wall on one of the cell's edges
//         'prop'    — one per cell, on the floor tile if there is one
//         'rug'     — floor decoration under a prop (one per cell)
//         'hang'    — hangs from a roof (one per cell)
//         'surface' — small things on a table or chest top (up to 4 per surface)
// Chunk B unlocks: `locked` pieces appear once a Wren request rewards them (build_piece); `decor` and
// `keepsake` pieces cost one of themselves (inventory count) so placing/removing moves them in and
// out of the pack. Flavor lines come from story/data/item_flavor.json + biscuit_finds.json.
import { spriteHtml } from '../ui/icons.js';
import { STORY } from '../data/story.js';

const F = STORY.itemFlavor;
export const PIECES = {
  floor:   { name: 'Floor',         icon: 'floor-plank', slot: 'cell', model: 'floorPiece',   cost: { wood: 2, stone: 1 }, flavor: F.buildPieces.floor },
  wall:    { name: 'Wall',          icon: 'wall-log',    slot: 'edge', model: 'wallPiece',    cost: { wood: 3 }, flavor: F.buildPieces.wall },
  window:  { name: 'Window wall',   icon: 'wall-log-window', slot: 'edge', model: 'windowPiece', cost: { wood: 3, stone: 1 }, flavor: F.buildPieces.window_wall },
  door:    { name: 'Door',          icon: 'wall-log-door', slot: 'edge', model: 'doorPiece',  cost: { wood: 4 }, flavor: F.buildPieces.door },
  roof:    { name: 'Roof',          icon: 'roof-log',    slot: 'roof', model: 'roofPiece',    cost: { wood: 3, stone: 1 }, flavor: F.buildPieces.roof },
  hearth:  { name: 'Hearth',        icon: '🔥',          slot: 'prop', model: null,           cost: { wood: 2, stone: 6 }, flavor: F.buildPieces.hearth },
  bedroll: { name: 'Bed roll',      icon: 'bedroll',     slot: 'prop', model: 'bedrollPiece', cost: { wood: 2 }, flavor: F.buildPieces.bed_roll },
  lantern: { name: 'Lantern',       icon: 'lantern_double', slot: 'prop', model: 'lanternPiece', cost: { wood: 1, stone: 2 }, flavor: F.buildPieces.lantern },
  table:   { name: 'Table',         icon: '🪑',          slot: 'prop', model: null,           cost: { wood: 4 }, flavor: F.buildPieces.table },
  chest:   { name: 'Storage chest', icon: 'chest',       slot: 'prop', model: 'chestPiece',   cost: { wood: 5, stone: 1 }, flavor: F.buildPieces.chest },
  // request rewards (build_piece)
  lantern_double: { name: 'Double lantern', icon: 'lantern_double', slot: 'prop', model: 'lanternPiece', cost: { wood: 1, stone: 3 }, locked: true, flavor: F.rewards.lantern_double },
  lakeside_bench: { name: 'Lakeside bench', icon: 'lakeside_bench', slot: 'prop', model: 'benchPiece', cost: { wood: 3, stone: 1 }, locked: true, flavor: F.rewards.lakeside_bench },
  // request rewards (decoration): cost = the decoration itself
  herb_bundle:        { name: 'Herb bundle',  icon: 'herb_bundle', slot: 'hang', model: 'herbBundle', cost: { herb_bundle: 1 }, decor: true, flavor: F.rewards.herb_bundle },
  woven_rug:          { name: 'Woven rug',    icon: 'woven_rug',   slot: 'rug',  model: 'wovenRug',   cost: { woven_rug: 1 }, decor: true, flavor: F.rewards.woven_rug },
  biscuit_bed:        { name: 'Biscuit’s bed', icon: 'biscuit_bed', slot: 'prop', model: 'biscuitBed', cost: { biscuit_bed: 1 }, decor: true, flavor: F.rewards.biscuit_bed },
  crystal_wind_chime: { name: 'Wind chime',   icon: 'crystal_wind_chime', slot: 'hang', model: 'windChime', cost: { crystal_wind_chime: 1 }, decor: true, flavor: F.rewards.crystal_wind_chime },
};
// Biscuit's keepsakes (biscuit_finds.json, keepsake: true) — placed on table/chest tops
export const KEEPSAKES = STORY.biscuitFinds.finds.filter((f) => f.keepsake);
for (const k of KEEPSAKES) {
  PIECES[k.id] = { name: k.name, icon: k.id, slot: 'surface', model: `ks_${k.id}`, cost: { [k.id]: 1 }, keepsake: true, flavor: k.flavor };
}
export const PIECE_ORDER = Object.keys(PIECES);
export const BASE_PIECES = PIECE_ORDER.filter((t) => !PIECES[t].locked && !PIECES[t].decor && !PIECES[t].keepsake);

const RES_LABEL = { crystal_shard: 'crystal shard' };
export function costText(cost) {
  return Object.entries(cost).map(([k, n]) => (PIECES[k] ? `${n} ${PIECES[k].name.toLowerCase()}` : `${n} ${RES_LABEL[k] || k}`)).join(' + ');
}

/** Atlas sprite (M2: icons/atlas.png, aliases resolved), legacy <img>, or emoji markup for an icon id. */
export function iconHtml(icon, cls = '') {
  const sp = spriteHtml(icon, cls);
  if (sp) return sp;
  if (/^[a-z0-9_-]+$/i.test(icon)) return `<img class="ico-img ${cls}" src="assets/icons/${icon}.png" alt="" draggable="false">`;
  return `<span class="ico ${cls}">${icon}</span>`;
}
