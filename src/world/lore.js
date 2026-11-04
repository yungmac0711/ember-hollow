// Lore notes (story/data/lore_notes.json, DATA_FORMATS §4) — Chunk B.
// Each note is placed in its area following its placementHint, using the art/assets/lore props
// (pinned paper, Edda's lamp-book page, the miner's slate, the rusted waylamp hook) plus a few
// primitive bits for the hints (a rock, a mossy stump with a pebble, a flat stone). All props are
// merged into one vertex-coloured mesh (+1 unlit mesh for the emissive glowcaps: 2 draw calls total). Cam reads a note with Use when near it or
// by tapping it; the parchment reader (ui/parchment_reader.png, 9-slice) shows it, it's marked read
// (saved) and added to the journal in the pack. Chunk C places the clearing note as a carving on a
// birch at the clearing edge (spot from src/world/surface.js). Chunk D places the Glowmere's note in a
// stoppered jar lying on the lakeshore (spot from src/world/glowmere.js), so every note is now placed.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STORY } from '../data/story.js';
import { mulberry32 } from './noise.js';
import { batchGeometry } from '../build/shelter.js';
import { onTap } from '../ui/tap.js';

const _v = new THREE.Vector3();

function prim(geometry, color) { return { geometry, material: new THREE.MeshLambertMaterial({ color }) }; }

export class LoreNotes {
  constructor(scene, cave, seed, props) {
    this.cave = cave;
    this.notes = []; // {id, title, text, kind, pos, read}
    this.read = new Set();
    const rng = mulberry32((seed ^ 0x10fe) >>> 0);
    const geos = [], glowGeos = [], jarGeos = [], jarGlow = [];
    let into = [geos, glowGeos]; // the Glowmere jar gets its own pair so it's hidden with the grotto
    const add = (parts, m) => {
      for (const p of parts || []) {
        const b = batchGeometry(p); if (!b) continue;
        b.geometry.applyMatrix4(m); into[b.glow ? 1 : 0].push(b.geometry);
      }
    };
    const mat = (x, y, z, yaw = 0, pitch = 0, s = 1) => new THREE.Matrix4().compose(_v.set(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')), new THREE.Vector3(s, s, s));
    const ch = Object.fromEntries(cave.chambers.map((c) => [c.id, c]));
    // a point near the chamber wall (field ~1.1 m), facing the chamber centre
    const wallSpot = (c, minF = 0.9, maxF = 1.5) => {
      for (let i = 0; i < 200; i++) {
        const a = rng() * Math.PI * 2, r = c.r * (0.55 + rng() * 0.5);
        const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r, f = cave.field(x, z);
        if (f >= minF && f <= maxF) return { x, z, y: cave.floorAt(x, z), yaw: Math.atan2(c.x - x, c.z - z) };
      }
      return { x: c.x, z: c.z + 2, y: cave.floorAt(c.x, c.z + 2), yaw: 0 };
    };
    const openSpot = (x, z) => ({ x, z, y: cave.floorAt(x, z), yaw: Math.atan2(-x + (ch.lanternmouth?.x || 0), -z) });

    const place = {
      // "On a rock beside the starting campfire." (Cam lights the first fire by the spawn point)
      note_wren_arrival: () => {
        const s = openSpot((ch.lanternmouth?.x || 0) - 1.7, (ch.lanternmouth?.z || 0) + 3.6);
        const rock = new THREE.DodecahedronGeometry(0.32, 0); rock.scale(1.2, 0.55, 1);
        add([prim(rock, 0x55606b)], mat(s.x, s.y + 0.1, s.z, s.yaw));
        add(props.note, mat(s.x, s.y + 0.27, s.z, s.yaw, -0.35, 0.9));
        return { ...s, y: s.y + 0.3 };
      },
      // "Tucked in a niche near the cave mouth, under a rusted waylamp hook."
      journal_grandmother_1: () => {
        const s = wallSpot(ch.lanternmouth, 0.7, 1.1);
        add(props.hook, mat(s.x - Math.sin(s.yaw) * 0.25, s.y + 1.45, s.z - Math.cos(s.yaw) * 0.25, s.yaw));
        const ledge = new THREE.BoxGeometry(0.55, 0.12, 0.4);
        add([prim(ledge, 0x4a535e)], mat(s.x, s.y + 0.06, s.z, s.yaw));
        add(props.journal, mat(s.x, s.y + 0.125, s.z, s.yaw + 0.2));
        return { ...s, y: s.y + 0.2 };
      },
      // "Scratched on a slate near the dry seam."
      note_flint_miner: () => {
        const s = wallSpot(ch.flintseam);
        add(props.slate, mat(s.x, s.y, s.z, s.yaw, -0.18, 1.1));
        return { ...s, y: s.y + 0.15 };
      },
      // "Half-buried under glowcaps on a ledge."
      journal_keepers: () => {
        const s = wallSpot(ch.glowcap);
        const ledge = new THREE.CylinderGeometry(0.45, 0.55, 0.3, 7);
        add([prim(ledge, 0x3d4a45)], mat(s.x, s.y + 0.15, s.z, s.yaw));
        add(props.journal, mat(s.x, s.y + 0.305, s.z, s.yaw - 0.3));
        for (let k = 0; k < 3; k++) { // a few glowcaps over it (soft emissive, no light)
          const cap = new THREE.SphereGeometry(0.07, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
          const p = { geometry: cap, material: new THREE.MeshLambertMaterial({ color: 0x1b6f73, emissive: 0x2fd6d0, emissiveIntensity: 1 }) };
          add([p], mat(s.x + Math.cos(k * 2.1) * 0.2, s.y + 0.32, s.z + Math.sin(k * 2.1) * 0.2));
        }
        return { ...s, y: s.y + 0.35 };
      },
      // "Weighted by a pebble on a mossy stump."
      note_mossdrip_moss: () => {
        const s = wallSpot(ch.mossdrip, 1.2, 2.2);
        add([prim(new THREE.CylinderGeometry(0.24, 0.3, 0.42, 7), 0x5a4330)], mat(s.x, s.y + 0.21, s.z));
        add([prim(new THREE.CylinderGeometry(0.245, 0.245, 0.03, 7), 0x4f7a3a)], mat(s.x, s.y + 0.43, s.z));
        add(props.note, mat(s.x, s.y + 0.45, s.z, s.yaw, -Math.PI / 2 + 0.05, 0.9));
        add([prim(new THREE.DodecahedronGeometry(0.045, 0), 0x6d7480)], mat(s.x, s.y + 0.48, s.z + 0.03));
        return { ...s, y: s.y + 0.5 };
      },
      // "On a flat stone beside the Hushing Pools."
      journal_grandmother_2: () => {
        const c = ch.hushing;
        const s = wallSpot(c, 1.0, 1.8);
        const stone = new THREE.CylinderGeometry(0.42, 0.48, 0.16, 8); stone.scale(1.2, 1, 0.9);
        add([prim(stone, 0x5b6470)], mat(s.x, s.y + 0.08, s.z, s.yaw));
        add(props.journal, mat(s.x, s.y + 0.165, s.z, s.yaw + 0.4));
        return { ...s, y: s.y + 0.2 };
      },
      // "On a birch trunk at the edge of the clearing." — a pale bark blaze with carved lines, at chest
      // height on the side facing the clearing (Chunk C; the birch itself is a deco tree in surface.js)
      note_clearing_stars: () => {
        const b = props.clearingBirch; if (!b) return null;
        const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), r = b.trunkR + 0.005;
        const x = b.x + fx * r, z = b.z + fz * r, y = b.y + 1.3;
        add([prim(new THREE.BoxGeometry(0.2, 0.34, 0.02), 0xd8ccb0)], mat(x, y, z, b.yaw));
        for (let k = 0; k < 4; k++) add([prim(new THREE.BoxGeometry(0.13 - (k % 2) * 0.04, 0.012, 0.012), 0x5a4632)], mat(x + fx * 0.012, y + 0.1 - k * 0.065, z + fz * 0.012, b.yaw));
        return { x: x + fx * 0.35, z: z + fz * 0.35, y, yaw: b.yaw };
      },
      // "In a stoppered jar on the lakeshore." — a sea-glass jar on its side, cork in, rolled note inside
      note_glowmere_wish: () => {
        const j = props.glowmereJar; if (!j) return null;
        into = [jarGeos, jarGlow];
        add(props.jar, mat(j.x, j.y, j.z, j.yaw, 0, 1.25)); // art/assets/lore/note_jar.glb (emissive jar_glow)
        add([prim(new THREE.DodecahedronGeometry(0.08, 0), 0x55606b)], mat(j.x + 0.18, j.y + 0.03, j.z - 0.08)); // a shore pebble beside it
        into = [geos, glowGeos];
        return { ...j, y: j.y + 0.25 };
      },
    };
    for (const n of STORY.lore.notes || []) {
      if (n.area === 'emberdeep') { this.deferred = (this.deferred || []).concat(n.id); continue; } // M2 chunk C: the 4 Emberdeep notes spawn with the area (chunk E)
      const fn = place[n.id];
      if (!fn || !ch[n.area]) { this.skipped = (this.skipped || []).concat(n.id); continue; }
      const s = fn();
      if (!s) { this.skipped = (this.skipped || []).concat(n.id); continue; }
      this.notes.push({ id: n.id, title: n.title, text: n.text, kind: n.kind, area: n.area, pos: new THREE.Vector3(s.x, s.y, s.z) });
    }
    this.mesh = null;
    if (geos.length) {
      this.mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ vertexColors: true }));
      this.mesh.name = 'lore-notes';
      scene.add(this.mesh);
    }
    if (glowGeos.length) { // emissive bits (the glowcaps on the keepers' ledger): unlit, no light
      this.glow = new THREE.Mesh(mergeGeometries(glowGeos), new THREE.MeshBasicMaterial({ vertexColors: true }));
      scene.add(this.glow);
    }
    // the jar: named so Glowmere.update hides it with the grotto's other meshes
    if (jarGeos.length) { const m = new THREE.Mesh(mergeGeometries(jarGeos), new THREE.MeshLambertMaterial({ vertexColors: true })); m.name = 'lore-jar'; scene.add(m); }
    if (jarGlow.length) { const m = new THREE.Mesh(mergeGeometries(jarGlow), new THREE.MeshBasicMaterial({ vertexColors: true })); m.name = 'lore-jar-glow'; scene.add(m); }
  }

  /** Nearest note within reach (any), preferring ones in front. */
  findTarget(pos, forward, reach = 2.0) {
    let best = null, bs = Infinity;
    for (const n of this.notes) {
      const dx = n.pos.x - pos.x, dz = n.pos.z - pos.z, d = Math.hypot(dx, dz);
      if (d > reach) continue;
      const facing = d > 1e-3 ? (dx * forward.x + dz * forward.z) / d : 1;
      if (d > 0.9 && facing < 0.2) continue;
      const s = d - facing; if (s < bs) { bs = s; best = n; }
    }
    return best;
  }
  /** Note under a screen tap (projected within ~48 px), within 6 m. */
  pickScreen(x, y, camera, playerPos) {
    let best = null, bd = 48;
    for (const n of this.notes) {
      if (Math.hypot(n.pos.x - playerPos.x, n.pos.z - playerPos.z) > 6) continue;
      _v.copy(n.pos).project(camera);
      if (_v.z > 1) continue;
      const sx = (_v.x + 1) / 2 * window.innerWidth, sy = (1 - _v.y) / 2 * window.innerHeight;
      const d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  nearestUnread(pos, r) {
    let best = null, bd = r;
    for (const n of this.notes) {
      if (this.read.has(n.id)) continue;
      const d = Math.hypot(n.pos.x - pos.x, n.pos.z - pos.z); if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  get(id) { return this.notes.find((n) => n.id === id) || (STORY.lore.notes || []).find((n) => n.id === id); }
  markRead(id) { const was = this.read.has(id); this.read.add(id); return !was; }
  journal() { return [...this.read].map((id) => this.get(id)).filter(Boolean).map((n) => ({ id: n.id, title: n.title })); }
}

/** Parchment reader (9-slice ui/parchment_reader.png via CSS border-image). */
export class ParchmentReader {
  constructor(el) {
    this.el = el;
    this.title = el.querySelector('.pr-title'); this.body = el.querySelector('.pr-text');
    onTap(el, () => this.hide(), (t) => (t === el || t.closest?.('.pr-close') ? true : null));
    this.onClose = null;
  }
  get open() { return !this.el.classList.contains('hidden'); }
  show(note) {
    this.title.textContent = note.title;
    this.body.innerHTML = '';
    for (const para of String(note.text).split(/\n+/)) { const p = document.createElement('p'); p.textContent = para; this.body.appendChild(p); }
    this.el.classList.remove('hidden');
    this.el.dataset.note = note.id;
  }
  hide() { if (!this.open) return; this.el.classList.add('hidden'); this.onClose?.(); }
}
