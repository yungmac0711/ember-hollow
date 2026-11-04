// DOM HUD (inventory/hotbar lives in inventory-ui.js): hints, toasts, Wren subtitles, area names, campfire fuel, FPS counter.
import { CONFIG, TIER } from '../config.js';
import { iconHtml } from '../build/pieces.js';

export const HUD_SCALE = { small: 0.85, medium: 1, large: 1.15 };

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
    this._hintT = 0; this._hintSticky = false;
    this._prioT = 0; this._q = []; this._later = null; this.prioLog = [];
  }

  /** M2 chunk A: small translucent buttons drawn from Art's ui_ glyphs (call once the atlas is loaded). */
  initGlyphs() {
    const glyph = (id, key, alt) => { const el = $(id); if (el) el.innerHTML = iconHtml(key) || alt; };
    glyph('btn-pause', 'ui_menu', '⏸'); glyph('btn-build', 'ui_craft', '🔨'); glyph('btn-craft', 'crafting_bench', '🛠'); glyph('btn-journal', 'ui_journal', '📖');
    $('btn-chat').innerHTML = '<span class="ico">💬</span>';
    const w = $('warmth'); w.querySelector('.ico').innerHTML = iconHtml('ui_warmth');
    this.fuel.querySelector('.ico').textContent = '🔥';
  }

  /** HUD size (S/M/L) and the hide-HUD toggle (Settings, or H on a keyboard). */
  setLayout({ hudScale = 'medium', hideHud = false } = {}) {
    document.documentElement.style.setProperty('--hs', String(HUD_SCALE[hudScale] || 1));
    document.body.classList.toggle('hud-hidden', !!hideHud);
  }

  /** Settings → Show FPS (or ?fps=1): small top-right readout, safe-area aware (css #fps). */
  setFps(on) {
    this.showFps = on; this.fpsEl.classList.toggle('hidden', !on);
    this._frames = 0; this._fpsT = 0; this._fn = 0; this._prev = 0;
  }

  /** Hints are transient now: shown ~6 s when they change (sticky while building), then fade. */
  setHint(text, sticky = false) {
    if (this.hint.textContent !== text) { this.hint.textContent = text; this._hintT = 6; }
    this._hintSticky = sticky;
    this.hint.classList.toggle('show', !!text && (sticky || this._hintT > 0));
  }
  /** Bring the current hint back for a few seconds (Cam idle for a while). */
  nudgeHint(secs = 5) { if (this.hint.textContent) { this._hintT = secs; this.hint.classList.add('show'); } }

  setInteract(label) {
    const l = label || 'Use';
    if (this.interactLabel.textContent !== l) this.interactLabel.textContent = l;
    this.interactBtn.classList.toggle('ready', !!label);
  }

  setBuildActive(on) { this.buildBtn.classList.toggle('active', on); }
  setRemoveActive(on) { $('btn-remove').classList.toggle('active', !!on); }

  /** prio (M2 chunk C: journal goals, chapters, coziness tiers): queues behind another prio toast and
   *  isn't overwritten by ordinary toasts while it shows. */
  toast(text, secs = 2.2, prio = false) {
    if (this._prioT > 0) { if (prio) this._q.push([text, secs]); else this._later = [text, Math.min(secs, 1.6)]; return; }
    this.toastEl.textContent = text; this.toastEl.classList.add('show'); this._toastT = secs;
    this.lastToast = text; if (prio) { this._prioT = secs; this.prioLog.push(text); if (this.prioLog.length > 20) this.prioLog.shift(); }
  }

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
    if (this._prioT > 0 && (this._prioT -= dt) <= 0) {
      if (this._q.length) { const [t, sc] = this._q.shift(); this.toast(t, sc, true); }
      else if (this._later) { const [t, sc] = this._later; this._later = null; this.toast(t, sc); }
    }
    if (this._toastT > 0 && (this._toastT -= dt) <= 0) this.toastEl.classList.remove('show');
    if (this._hintT > 0 && (this._hintT -= dt) <= 0 && !this._hintSticky) this.hint.classList.remove('show');
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
