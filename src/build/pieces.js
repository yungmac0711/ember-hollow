// Building catalogue (M1). Costs are wood + stone only. Geometry is the M1 art set (art/assets/
// build + props: log walls/door/window, plank floor, lean-to roof, double lantern, chest, bed
// roll); the hearth is a real campfire (FireSystem) and the table is a chunky primitive until
// art makes one. `icon` is a file in assets/icons/ (or an emoji when there's no icon yet).
//   slot: 'cell'  — floor tile, fills a 2 m grid cell
//         'edge'  — wall-like, sits on a cell edge (walls, window wall, door)
//         'roof'  — over a cell at wall height; needs a wall on one of the cell's edges
//         'prop'  — one per cell, on the floor tile if there is one
export const PIECES = {
  floor:   { name: 'Floor',         icon: 'floor-plank', slot: 'cell', model: 'floorPiece',   cost: { wood: 2, stone: 1 } },
  wall:    { name: 'Wall',          icon: 'wall-log',    slot: 'edge', model: 'wallPiece',    cost: { wood: 3 } },
  window:  { name: 'Window wall',   icon: 'wall-log-window', slot: 'edge', model: 'windowPiece', cost: { wood: 3, stone: 1 } },
  door:    { name: 'Door',          icon: 'wall-log-door', slot: 'edge', model: 'doorPiece',  cost: { wood: 4 } },
  roof:    { name: 'Roof',          icon: 'roof-log',    slot: 'roof', model: 'roofPiece',    cost: { wood: 3, stone: 1 } },
  hearth:  { name: 'Hearth',        icon: '🔥',          slot: 'prop', model: null,           cost: { wood: 2, stone: 6 } },
  bedroll: { name: 'Bed roll',      icon: 'bedroll',     slot: 'prop', model: 'bedrollPiece', cost: { wood: 2 } },
  lantern: { name: 'Lantern',       icon: 'lantern_double', slot: 'prop', model: 'lanternPiece', cost: { wood: 1, stone: 2 } },
  table:   { name: 'Table',         icon: '🪑',          slot: 'prop', model: null,           cost: { wood: 4 } },
  chest:   { name: 'Storage chest', icon: 'chest',       slot: 'prop', model: 'chestPiece',   cost: { wood: 5, stone: 1 } },
};
export const PIECE_ORDER = Object.keys(PIECES);

export function costText(cost) {
  return Object.entries(cost).map(([k, n]) => `${n} ${k}`).join(' + ');
}

/** <img> or emoji markup for an icon id. */
export function iconHtml(icon, cls = '') {
  if (/^[a-z0-9_-]+$/i.test(icon)) return `<img class="ico-img ${cls}" src="assets/icons/${icon}.png" alt="" draggable="false">`;
  return `<span class="ico ${cls}">${icon}</span>`;
}
