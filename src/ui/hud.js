// DOM HUD (inventory/hotbar lives in inventory-ui.js): hints, toasts, Wren subtitles, area names, campfire fuel, FPS counter.
import { CONFIG, TIER } from '../config.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.hint = $('hint'); this.toastEl = $('toast'); this.area = $('area-name');
    this.fuel = $('fuel'); this.fuelFill = this.fuel.querySelector('.fill'); this.fuelLabel = this.fuel.querySelector('.label');
    this.sub = $('subtitle'); this.subLine = this.sub.querySelector('.line');
    this.sub.querySelector('.who').textContent = CONFIG.companion.name;
    this.fpsEl = $('fps'); this.interactBtn = $('btn-interact'); this.interactLabel = this.interactBtn.querySelector('.label');
    this.buildBtn = $('btn-build');
    this.showFps = false; this.setFps(CONFIG.debug.fps);
    this._ft = new Float32Array(600); this._fi = 0; this._fn = 0; this._prev = 0; // last ~10 s of frame times
    this._last = {}; this._toastT = 0; this._subT = 0; this._areaT = 0;
    this._frames = 0; this._fpsT = 0;
  }

  /** Settings → Show FPS (or ?fps=1): small top-right readout, safe-area aware (css #fps). */
  setFps(on) {
    this.showFps = on; this.fpsEl.classList.toggle('hidden', !on);
    this._frames = 0; this._fpsT = 0; this._fn = 0; this._prev = 0;
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
    if (this.showFps) {
      // real frame times (not the clamped game dt): 1 s average + 1% low over the last ~10 s
      const now = performance.now(), ft = this._prev ? (now - this._prev) / 1000 : 0; this._prev = now;
      if (ft > 0 && ft < 1) { this._ft[this._fi] = ft; this._fi = (this._fi + 1) % this._ft.length; this._fn = Math.min(this._fn + 1, this._ft.length); this._frames++; this._fpsT += ft; }
      if (this._fpsT >= 1) {
        const i = renderer.info.render, n = this._fn, sorted = Array.from(this._ft.subarray(0, n)).sort((a, b) => b - a);
        const worst = sorted.slice(0, Math.max(1, Math.floor(n / 100)));
        const avg = this._frames / this._fpsT;
        const low1 = Math.min(avg, worst.length / worst.reduce((a, b) => a + b, 0)); // mean of the slowest 1% → fps
        const tier = TIER.live ? 'low' : 'high', pend = TIER.live !== TIER.low ? '*' : '';
        this.fpsEl.textContent = `${Math.round(avg)} fps · 1% ${Math.round(low1)}\n${i.calls} calls · ${tier}${pend}`;
        this.fpsStats = { fps: avg, low1, calls: i.calls, tier };
        this._frames = 0; this._fpsT = 0;
      }
    }
  }
}
