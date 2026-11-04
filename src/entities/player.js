// First-person player: capsule-ish circle vs. the cave field, gravity, jump, head clamp.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const P = CONFIG.player;

export class Player {
  constructor(camera, cave, spawn) {
    this.camera = camera;
    this.cave = cave;
    this.pos = spawn.clone();         // feet position
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = -0.05;
    this.onGround = false;
    this.speed = 0;                   // current horizontal speed (for puppy logic)
    this.stillTime = 0;
    this.inventory = { wood: 0, stone: 0, flint: 0, mushroom: 0, glowcap: 0, crystal_shard: 0, stew: 0 };
    this._bob = 0;
    this._s = {};
    this.camera.rotation.order = 'YXZ';
  }

  get forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  /** Chunk D: sit on a seat {pos (seat top), yaw (facing), stand (Vector3)} — the camera eases out. */
  sit(seat) {
    this.seat = seat; this.sitE = this.sitE || 0; this._sitHold = 0.6; // ignore the stick briefly
    this.vel.set(0, 0, 0); this.speed = 0;
    this.pos.set(seat.pos.x, seat.pos.y, seat.pos.z);
    this.yaw = seat.yaw; this.pitch = -0.2;
  }
  stand() {
    if (!this.seat) return;
    const s = this.seat; this.seat = null;
    this.pos.copy(s.stand); this.pos.y = this.cave.floorAt(s.stand.x, s.stand.z);
    this.onStand?.(s);
  }

  update(dt, input) {
    const look = input.consumeLook();
    this.yaw -= look.x;
    this.pitch = Math.max(-P.pitchLimit, Math.min(P.pitchLimit, this.pitch - look.y * (this.invertY ? -1 : 1)));
    const fovWant = (this.baseFov || 70) + 6 * (this.sitE || 0);
    if (Math.abs(this.camera.fov - fovWant) > 0.01) { this.camera.fov = fovWant; this.camera.updateProjectionMatrix(); }
    if (this.seat) {
      // seated: no walking; push the stick (or jump) to stand up. Camera eases back + up a little
      // so Cam's view takes in Wren beside them and the water (≈1.2 s ease).
      this._sitHold -= dt;
      if (this._sitHold <= 0 && (Math.hypot(input.move.x, input.move.y) > 0.5 || input.jumpHeld)) { this.stand(); return this.update(0, input); }
      this.sitE = Math.min(1, (this.sitE || 0) + dt / 1.2);
      const e = this.sitE * this.sitE * (3 - 2 * this.sitE);
      const fx = -Math.sin(this.seat.yaw), fz = -Math.cos(this.seat.yaw);
      this.speed = 0; this.stillTime += dt; this.onGround = true;
      // Polish: frame Cam (the seated stand-in) and Wren together, roughly centred, with the water
      // beyond: the camera eases to behind and above the middle of the pair, looking out past them.
      const w = this.seat.wren?.pos, S = CONFIG.player.seatCam;
      const mx = w ? (this.pos.x + w.x) / 2 : this.pos.x, mz = w ? (this.pos.z + w.z) / 2 : this.pos.z;
      const ex = this.pos.x, ey = this.pos.y + 0.78, ez = this.pos.z; // seated eye (where the ease starts)
      let sx = 0, sz = 0; // a little out to Cam's side for a three-quarter view of the pair
      if (w) { sx = this.pos.x - w.x; sz = this.pos.z - w.z; const l = Math.hypot(sx, sz) || 1; sx /= l; sz /= l; }
      const cx = mx - fx * S.back + sx * S.side, cy = this.pos.y + S.up, cz = mz - fz * S.back + sz * S.side;
      this.camera.position.set(ex + (cx - ex) * e, ey + (cy - ey) * e, ez + (cz - ez) * e);
      this.cave.resolve(this.camera.position, 0.4);
      // aim at a point out over the water just above the pair's heads
      const tx = mx + fx * S.ahead, ty = this.pos.y + S.lookY, tz = mz + fz * S.ahead;
      const dx = tx - this.camera.position.x, dy = ty - this.camera.position.y, dz = tz - this.camera.position.z;
      const aimYaw = Math.atan2(-dx, -dz), aimPitch = Math.atan2(dy, Math.hypot(dx, dz));
      let dYaw = aimYaw - this.seat.yaw; dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
      const yawLook = this.seat.yaw + dYaw * e + (this.yaw - this.seat.yaw);
      const pitchLook = -0.2 + (aimPitch + 0.2) * e + (this.pitch + 0.2);
      this.camera.rotation.set(Math.max(-1.2, Math.min(1.2, pitchLook)), yawLook, 0);
      return;
    }
    this.sitE = Math.max(0, (this.sitE || 0) - dt * 3);

    // Horizontal movement relative to yaw
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const mx = input.move.x, my = input.move.y;
    const wishX = (-sin * my + cos * mx) * P.walkSpeed;
    const wishZ = (-cos * my - sin * mx) * P.walkSpeed;
    const accel = this.onGround ? 14 : 4;
    this.vel.x += (wishX - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wishZ - this.vel.z) * Math.min(1, accel * dt);

    if (input.jumpHeld && this.onGround) { this.vel.y = P.jumpVelocity; this.onGround = false; }
    this.vel.y -= P.gravity * dt;

    // Sub-step horizontal motion so fast moves can't tunnel through thin walls
    const dx = this.vel.x * dt, dz = this.vel.z * dt;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
    const minF = P.radius + 0.45;
    const before = this.pos.clone();
    for (let i = 0; i < steps; i++) {
      this.pos.x += dx / steps; this.pos.z += dz / steps;
      this.cave.resolve(this.pos, minF);
      this.colliders?.resolve(this.pos, P.radius);
    }
    // keep velocity consistent with where we actually went (wall sliding)
    if (dt > 0) { this.vel.x = (this.pos.x - before.x) / dt; this.vel.z = (this.pos.z - before.z) / dt; }

    // Vertical
    const s = this.cave.sample(this.pos.x, this.pos.z, this._s);
    if (this.extraFloor) s.floor = Math.max(s.floor, this.extraFloor(this.pos.x, this.pos.z));
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= s.floor) {
      this.pos.y = s.floor;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > s.floor + 0.08) {
      this.onGround = false;
    } else if (this.vel.y <= 0) {
      this.pos.y = s.floor; this.onGround = true; this.vel.y = 0; // stick to gentle downslopes
    }
    const headroom = s.ceil - 0.15 - (P.eyeHeight + 0.15);
    if (this.pos.y > headroom) { this.pos.y = Math.max(s.floor, headroom); if (this.vel.y > 0) this.vel.y = 0; }

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.stillTime = this.speed < 0.3 ? this.stillTime + dt : 0;

    // Camera with a subtle head bob
    const pb = this._bob;
    this._bob += this.onGround ? this.speed * dt * 2.2 : 0;
    if (Math.floor(this._bob) !== Math.floor(pb) && this.speed > 0.8) this.onStep?.(); // one footfall per bob dip
    const bob = Math.sin(this._bob * Math.PI) * 0.035 * Math.min(1, this.speed / P.walkSpeed);
    this.camera.position.set(this.pos.x, this.pos.y + P.eyeHeight + bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
