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
    this.inventory = { wood: 0, stone: 0, flint: 0, mushroom: 0, glowcap: 0, shard: 0 };
    this._bob = 0;
    this._s = {};
    this.camera.rotation.order = 'YXZ';
  }

  get forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  update(dt, input) {
    const look = input.consumeLook();
    this.yaw -= look.x;
    this.pitch = Math.max(-P.pitchLimit, Math.min(P.pitchLimit, this.pitch - look.y));

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
    this._bob += this.onGround ? this.speed * dt * 2.2 : 0;
    const bob = Math.sin(this._bob * Math.PI) * 0.035 * Math.min(1, this.speed / P.walkSpeed);
    this.camera.position.set(this.pos.x, this.pos.y + P.eyeHeight + bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
