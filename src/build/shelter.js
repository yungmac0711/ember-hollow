// Shelter building — M0 placeholder. Build mode shows a snap-grid ghost of a wooden floor tile in
// front of Cam; Interact places it (costs wood + stone). Walls/roof/door/etc. are catalogued for M1.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { lambert } from '../assets.js';

// M1 catalogue (art/ASSETS.md mapping). Only 'floor' is placeable in M0.
export const PIECES = {
  floor:  { model: 'wood-floors-structures/floor.glb', cost: CONFIG.build.floorCost, enabled: true },
  wall:   { model: 'wood-walls-roofs/wall-wood.glb', cost: { wood: 3 }, enabled: false },
  window: { model: 'wood-walls-roofs/wall-wood-window-shutters.glb', cost: { wood: 3 }, enabled: false },
  door:   { model: 'wood-walls-roofs/wall-wood-door.glb', cost: { wood: 3 }, enabled: false },
  roof:   { model: 'wood-walls-roofs/roof-gable.glb', cost: { wood: 4 }, enabled: false },
  bedroll:{ model: 'props/bedroll.glb', cost: { wood: 1 }, enabled: false },
  lantern:{ model: 'wood-walls-roofs/lantern.glb', cost: { wood: 1, flint: 1 }, enabled: false },
};

const G = CONFIG.build.grid;

export class BuildSystem {
  constructor(scene, cave, floorParts) {
    this.scene = scene; this.cave = cave;
    this.active = false;
    this.tiles = new Map(); // "i,j" -> {mesh, top}
    this.parts = floorParts || [{ geometry: (() => { const g = new THREE.BoxGeometry(G, 0.12, G); g.translate(0, 0.06, 0); return g; })(), material: lambert(0x8a6440) }];
    const box = new THREE.Box3();
    for (const p of this.parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
    this.thickness = box.max.y;
    this.ghost = new THREE.Group();
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9cc4ff, transparent: true, opacity: 0.35, depthWrite: false });
    for (const p of this.parts) this.ghost.add(new THREE.Mesh(p.geometry, ghostMat));
    this.ghostMat = ghostMat;
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.cell = null;
  }

  toggle() { this.active = !this.active; this.ghost.visible = this.active; return this.active; }

  _cellFor(player) {
    const f = player.forward;
    const x = player.pos.x + f.x * 2.2, z = player.pos.z + f.z * 2.2;
    const i = Math.round(x / G), j = Math.round(z / G);
    const cx = i * G, cz = j * G;
    let ok = true, top = -Infinity;
    for (const [dx, dz] of [[0, 0], [-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
      const f2 = this.cave.field(cx + dx * G / 2, cz + dz * G / 2);
      if (f2 < 0.6) ok = false;
      top = Math.max(top, this.cave.floorAt(cx + dx * G / 2, cz + dz * G / 2));
    }
    if (top - this.cave.floorAt(cx, cz) > 0.6) ok = false; // too sloped
    if (this.tiles.has(`${i},${j}`)) ok = false;
    return { i, j, x: cx, z: cz, y: top, ok };
  }

  update(player) {
    if (!this.active) return;
    this.cell = this._cellFor(player);
    this.ghost.position.set(this.cell.x, this.cell.y + 0.01, this.cell.z);
    this.ghostMat.color.setHex(this.cell.ok ? 0x9cc4ff : 0xff6a6a);
  }

  canAfford(inv) { return Object.entries(PIECES.floor.cost).every(([k, n]) => (inv[k] || 0) >= n); }

  /** Try to place the current ghost. Returns 'placed' | 'blocked' | 'cost'. */
  place(inv) {
    if (!this.cell?.ok) return 'blocked';
    if (!this.canAfford(inv)) return 'cost';
    for (const [k, n] of Object.entries(PIECES.floor.cost)) inv[k] -= n;
    const g = new THREE.Group();
    for (const p of this.parts) g.add(new THREE.Mesh(p.geometry, p.material));
    g.position.set(this.cell.x, this.cell.y, this.cell.z);
    this.scene.add(g);
    this.tiles.set(`${this.cell.i},${this.cell.j}`, { mesh: g, top: this.cell.y + this.thickness });
    return 'placed';
  }

  /** Walkable top of a placed tile at (x,z), or -Infinity. */
  heightAt(x, z) {
    const t = this.tiles.get(`${Math.round(x / G)},${Math.round(z / G)}`);
    return t ? t.top : -Infinity;
  }

  summary() { return this.tiles.size ? `floor x${this.tiles.size}, no walls, no roof` : 'none'; }
}
