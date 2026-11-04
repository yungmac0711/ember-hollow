// DOM HUD (inventory/hotbar lives in inventory-ui.js): hints, toasts, Wren subtitles, area names, campfire fuel, FPS counter.
import { CONFIG } from '../config.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.hint = $('hint'); this.toastEl = $('toast'); this.area = $('area-name');
    this.fuel = $('fuel'); this.fuelFill = this.fuel.querySelector('.fill'); this.fuelLabel = this.fuel.querySelector('.label');
    this.sub = $('subtitle'); this.subLine = this.sub.querySelector('.line');
    this.sub.querySelector('.who').textContent = CONFIG.companion.name;
    this.fpsEl = $('fps'); this.interactBtn = $('btn-interact'); this.interactLabel = this.interactBtn.querySelector('.label');
    this.buildBtn = $('btn-build');
    if (CONFIG.debug.fps) this.fpsEl.classList.remove('hidden');
    this._last = {}; this._toastT = 0; this._subT = 0; this._areaT = 0;
    this._frames = 0; this._fpsT = 0;
  }

  setHint(text) { if (this.hint.textContent !== text) this.hint.textContent = text; }

  setInteract(label) {
    const l = label || 'Use';
    if (this.interactLabel.textContent !== l) this.interactLabel.textContent = l;
    this.interactBtn.classList.toggle('ready', !!label);
  }

  setBuildActive(on) { this.buildBtn.classList.toggle('active', on); }
  setRemoveActive(on) { $('btn-remove').classList.toggle('active', !!on); }

  toast(text, secs = 2.2) { this.toastEl.textContent = text; this.toastEl.classList.add('show'); this._toastT = secs; }

  say(line, secs) {
    this.subLine.textContent = line; this.sub.classList.add('show');
    this._subT = secs ?? Math.max(3.5, line.split(/\s+/).length * 0.38);
  }

  showArea(name) { this.area.textContent = name; this.area.classList.add('show'); this._areaT = 3; }

  setFuel(fire) {
    if (!fire) { this.fuel.classList.add('hidden'); return; }
    this.fuel.classList.remove('hidden');
    this.fuelFill.style.width = `${Math.round(fire.fuelFrac * 100)}%`;
    this.fuelLabel.textContent = fire.lit ? `Campfire · ${Math.ceil(fire.fuel / 60)} min` : 'Campfire · out';
  }

  update(dt, renderer) {
    if (this._toastT > 0 && (this._toastT -= dt) <= 0) this.toastEl.classList.remove('show');
    if (this._subT > 0 && (this._subT -= dt) <= 0) this.sub.classList.remove('show');
    if (this._areaT > 0 && (this._areaT -= dt) <= 0) this.area.classList.remove('show');
    if (CONFIG.debug.fps) {
      this._frames++; this._fpsT += dt;
      if (this._fpsT >= 0.5) {
        const i = renderer.info.render;
        this.fpsEl.textContent = `${Math.round(this._frames / this._fpsT)} fps\n${i.calls} calls\n${(i.triangles / 1000).toFixed(1)}k tris`;
        this._frames = 0; this._fpsT = 0;
      }
    }
  }
}
