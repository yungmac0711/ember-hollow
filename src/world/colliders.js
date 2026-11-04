// Simple 2D colliders on top of the cave field: circles (trees, rocks) and oriented boxes
// (walls, closed doors). The player, Wren and Biscuit are pushed out of them; Wren and Biscuit also
// steer around them with a short feeler (steer(), Chunk B) and hop to Cam if they get properly stuck.
export class Colliders {
  constructor() { this.list = new Set(); }

  circle(x, z, r) { const c = { type: 'c', x, z, r, on: true }; this.list.add(c); return c; }
  /** Oriented box centred on (x,z), half-extents hx (along yaw) and hz, rotated by yaw. */
  box(x, z, hx, hz, yaw) {
    const c = { type: 'b', x, z, hx, hz, cos: Math.cos(yaw), sin: Math.sin(yaw), on: true };
    this.list.add(c); return c;
  }
  remove(c) { if (c) this.list.delete(c); }

  /** Push `pos` (x,z) out of every active collider for a body of radius r. */
  resolve(pos, r) {
    for (const c of this.list) {
      if (!c.on) continue;
      if (c.type === 'c') {
        const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
        if (d < m && d > 1e-5) { pos.x = c.x + dx / d * m; pos.z = c.z + dz / d * m; }
      } else {
        // into box space (three.js yaw: local x axis = (cos, -sin) in xz)
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
        let ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez);
        let nx, nz;
        if (d > 1e-5) { if (d >= r) continue; nx = qx + ex / d * r; nz = qz + ez / d * r; }
        else { // centre inside: exit through the nearest face
          const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
          if (px < pz) { nx = Math.sign(lx || 1) * (c.hx + r); nz = lz; } else { nx = lx; nz = Math.sign(lz || 1) * (c.hz + r); }
        }
        pos.x = c.x + nx * c.cos + nz * c.sin; pos.z = c.z - nx * c.sin + nz * c.cos;
      }
    }
  }

  /** Would a body of radius r at (x,z) overlap an active collider? */
  hits(x, z, r) {
    _p.x = x; _p.z = z; this.resolve(_p, r);
    return Math.abs(_p.x - x) + Math.abs(_p.z - z) > 1e-4;
  }
}
const _p = { x: 0, z: 0 };

/**
 * Feeler steering for companions: returns a heading near `heading` whose point `look` metres ahead
 * is free of colliders (tries ±35°, ±70°, ±105°, ±140°, keeping the side it picked last time so it
 * doesn't dither). `mem` is a small per-agent object.
 */
export function steer(colliders, pos, heading, r, mem, look = 0.75) {
  if (!colliders || !colliders.list.size) return heading;
  const side = mem.side || 1;
  for (const k of [0, 1, 2, 3, 4]) {
    for (const sgn of k ? [side, -side] : [1]) {
      const h = heading + sgn * k * 0.61;
      if (!colliders.hits(pos.x + Math.sin(h) * look, pos.z + Math.cos(h) * look, r)) { if (k) mem.side = sgn; return h; }
    }
  }
  return heading;
}
