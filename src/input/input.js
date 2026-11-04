// Unified input: Minecraft-PE-style touch (floating left joystick, right-side drag look,
// on-screen buttons) + keyboard/mouse fallback with pointer lock. Multitouch via pointerId.
import { CONFIG } from '../config.js';

const JOY_RADIUS = 55;   // px of knob travel for full speed
const TAP_MS = 260, TAP_PX = 12;

export class Input {
  constructor({ touchLayer, canvas, joystickEl, buttons }) {
    this.enabled = true;
    this.move = { x: 0, y: 0 };      // x = strafe (+right), y = forward (+fwd), magnitude ≤ 1
    this.look = { x: 0, y: 0 };      // accumulated radians since last consume
    this.jumpHeld = false;
    this.pressed = new Set();        // edge-triggered actions: 'interact' | 'build' | 'chat' | 'jump'
    this.held = new Set();           // currently held buttons ('interact' for hold-to-gather)
    this.taps = [];                  // [{x,y}] screen taps on the look side (for raycast picking)
    this.usingTouch = false;

    this._joy = null;  // {id, ox, oy}
    this._lookPtr = null; // {id, lx, ly, t0, sx, sy, moved}
    this._keys = new Set();
    this._joyEl = joystickEl;
    this._knob = joystickEl.querySelector('.knob');
    this._canvas = canvas;

    touchLayer.addEventListener('pointerdown', (e) => this._down(e));
    window.addEventListener('pointermove', (e) => this._moveEv(e), { passive: false });
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('pointercancel', (e) => this._up(e, true));

    // On-screen buttons (each finger is independent thanks to pointer events)
    for (const [name, el] of Object.entries(buttons)) {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        el.setPointerCapture?.(e.pointerId);
        el.classList.add('active');
        this.pressed.add(name); this.held.add(name);
        if (name === 'jump') this.jumpHeld = true;
      });
      const release = (e) => { el.classList.remove('active'); this.held.delete(name); if (name === 'jump') this.jumpHeld = false; };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (this._typing()) return;
      this._keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'Space') { this.pressed.add('jump'); this.jumpHeld = true; e.preventDefault(); }
      if (e.code === 'KeyE' || e.code === 'KeyF') { this.pressed.add('interact'); this.held.add('interact'); }
      if (e.code === 'KeyB') this.pressed.add('build');
      if (e.code === 'KeyR') this.pressed.add('rotate');
      if (e.code === 'KeyX') this.pressed.add('remove');
      if (e.code === 'KeyI' || e.code === 'Tab') { this.pressed.add('bag'); e.preventDefault(); }
      if (/^Digit[1-9]$/.test(e.code)) this.pressed.add('slot' + e.code.slice(5));
      if (e.code === 'Digit0') this.pressed.add('slot10');
      if (e.code === 'KeyT' || e.code === 'Enter') { this.pressed.add('chat'); e.preventDefault(); }
      if (e.code === 'KeyG') this.pressed.add('stick');
      if (e.code === 'KeyL') this.pressed.add('lantern'); // M2: Cam's hand lantern
      if (e.code === 'KeyH') this.pressed.add('hidehud');
      if (e.code === 'Escape' || e.code === 'KeyP') this.pressed.add('pause');
    });
    window.addEventListener('keyup', (e) => {
      this._keys.delete(e.code);
      if (e.code === 'Space') this.jumpHeld = false;
      if (e.code === 'KeyE' || e.code === 'KeyF') this.held.delete('interact');
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.held.delete('interact'); });
    window.addEventListener('blur', () => { this._keys.clear(); this.held.clear(); this.jumpHeld = false; });

    // Mouse look with pointer lock
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this._canvas || !this.enabled) return;
      this.look.x += e.movementX * CONFIG.player.lookMouse * (this.sens ?? 1);
      this.look.y += e.movementY * CONFIG.player.lookMouse * (this.sens ?? 1);
    });

    // Belt-and-braces against scroll / zoom / pull-to-refresh / iOS gesture zoom
    const stop = (e) => { if (!this._typing() && !e.target.closest?.('.chat-log, .scroll, .panel-body')) e.preventDefault(); };
    document.addEventListener('touchmove', stop, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => { if (!this._typing()) e.preventDefault(); });
  }

  _typing() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  }

  requestPointerLock() {
    if (this.usingTouch) return;
    try { this._canvas.requestPointerLock?.(); } catch (_) { /* ignore */ }
  }

  _down(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      if (document.pointerLockElement !== this._canvas) this.requestPointerLock();
      else if (e.button === 0) { this.pressed.add('interact'); this.held.add('interact'); }
      return;
    }
    this.usingTouch = true;
    e.preventDefault();
    const leftSide = e.clientX < window.innerWidth * 0.42;
    if (leftSide && !this._joy) {
      this._joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this._joyEl.style.left = e.clientX + 'px';
      this._joyEl.style.top = e.clientY + 'px';
      this._joyEl.classList.remove('hidden');
      this._setKnob(0, 0);
    } else if (!leftSide && !this._lookPtr) {
      this._lookPtr = { id: e.pointerId, lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), moved: 0 };
    }
  }

  _moveEv(e) {
    if (this._joy && e.pointerId === this._joy.id) {
      e.preventDefault();
      let dx = e.clientX - this._joy.ox, dy = e.clientY - this._joy.oy;
      const len = Math.hypot(dx, dy);
      if (len > JOY_RADIUS) {
        // drag the base along so the stick never "sticks" at the rim (MCPE feel)
        const over = len - JOY_RADIUS;
        this._joy.ox += (dx / len) * over; this._joy.oy += (dy / len) * over;
        this._joyEl.style.left = this._joy.ox + 'px'; this._joyEl.style.top = this._joy.oy + 'px';
        dx = (dx / len) * JOY_RADIUS; dy = (dy / len) * JOY_RADIUS;
      }
      this._setKnob(dx, dy);
      const dead = 0.12;
      let mx = dx / JOY_RADIUS, my = -dy / JOY_RADIUS;
      const m = Math.hypot(mx, my);
      if (m < dead) { mx = 0; my = 0; } else { const k = (m - dead) / (1 - dead) / m; mx *= k; my *= k; }
      this.move.x = mx; this.move.y = my;
    } else if (this._lookPtr && e.pointerId === this._lookPtr.id) {
      e.preventDefault();
      const dx = e.clientX - this._lookPtr.lx, dy = e.clientY - this._lookPtr.ly;
      this._lookPtr.lx = e.clientX; this._lookPtr.ly = e.clientY;
      this._lookPtr.moved = Math.max(this._lookPtr.moved, Math.hypot(e.clientX - this._lookPtr.sx, e.clientY - this._lookPtr.sy));
      if (this.enabled) {
        this.look.x += dx * CONFIG.player.lookTouch * (this.sens ?? 1);
        this.look.y += dy * CONFIG.player.lookTouch * (this.sens ?? 1);
      }
    }
  }

  _up(e, cancel = false) {
    if (this._joy && e.pointerId === this._joy.id) {
      this._joy = null; this.move.x = 0; this.move.y = 0;
      this._joyEl.classList.add('hidden');
    } else if (this._lookPtr && e.pointerId === this._lookPtr.id) {
      const lp = this._lookPtr; this._lookPtr = null;
      if (!cancel && performance.now() - lp.t0 < TAP_MS && lp.moved < TAP_PX) this.taps.push({ x: lp.sx, y: lp.sy });
    }
  }

  /** A look-side finger held still (tap-hold on a target): {x, y, ms} or null. */
  get lookHold() {
    const lp = this._lookPtr;
    if (!lp || lp.moved >= TAP_PX) return null;
    return { x: lp.sx, y: lp.sy, ms: performance.now() - lp.t0 };
  }

  _setKnob(dx, dy) { this._knob.style.transform = `translate(${dx}px, ${dy}px)`; }

  /** Call once per frame: merges keyboard into move vector. */
  update() {
    if (!this._joy) {
      const k = this._keys;
      let x = 0, y = 0;
      if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
      if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
      const l = Math.hypot(x, y) || 1;
      this.move.x = x / l; this.move.y = y / l;
    }
    if (!this.enabled) { this.move.x = 0; this.move.y = 0; }
  }

  consumeLook() { const l = { x: this.look.x, y: this.look.y }; this.look.x = 0; this.look.y = 0; return l; }
  consume(name) { const had = this.pressed.has(name); this.pressed.delete(name); return had; }
  clearFrame() { this.pressed.clear(); this.taps.length = 0; }

  reset() {
    this._joy = null; this._lookPtr = null; this.move.x = this.move.y = 0; this.jumpHeld = false;
    this._keys.clear(); this.held.clear(); this.look.x = this.look.y = 0; this._joyEl.classList.add('hidden');
  }
}
