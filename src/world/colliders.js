// Simple 2D colliders on top of the cave field: circles (trees, rocks) and oriented boxes
// (walls, closed doors). The player (and nothing else, for now) is pushed out of them.
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
}
