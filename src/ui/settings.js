// Chunk D: Settings (title + pause menus). Everything is saved to localStorage under SETTINGS_KEY.
// Volumes / look sensitivity / invert-Y / Show FPS apply live. The graphics tier applies its pixel
// ratio and cull distances live (polish pass); the light pool size and scatter counts are fixed at
// load, so a changed tier still offers "Restart to apply" (saves the game first, then reloads).
// iOS: buttons use onTap (never click); sliders use the native 'input' event.
import { SETTINGS_KEY, TIER, tierLow } from '../config.js';
import { onTap } from './tap.js';

export const DEFAULTS = { master: 0.8, music: 1, effects: 1, sens: 1, invertY: false, tier: 'auto', showFps: false };

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export class SettingsPanel {
  constructor({ apply, beforeReload, onClose }) {
    this.s = loadSettings();
    this.apply = apply; this.onClose = onClose;
    this.el = document.getElementById('settings');
    const $ = (id) => document.getElementById(id);
    this.note = $('set-note'); this.reloadBtn = $('set-reload');
    const slider = (key, id, toVal, fromVal, fmt) => {
      const inp = $(id), out = $(id + '-v');
      const show = () => { out.textContent = fmt(this.s[key]); };
      inp.value = fromVal(this.s[key]); show();
      inp.addEventListener('input', () => { this.s[key] = toVal(Number(inp.value)); show(); this._changed(); });
      inp.addEventListener('pointerdown', (e) => e.stopPropagation());
    };
    const pct = (v) => `${Math.round(v * 100)}%`;
    slider('master', 'set-master', (v) => v / 100, (v) => Math.round(v * 100), pct);
    slider('music', 'set-music', (v) => v / 100, (v) => Math.round(v * 100), pct);
    slider('effects', 'set-effects', (v) => v / 100, (v) => Math.round(v * 100), pct);
    slider('sens', 'set-sens', (v) => v / 100, (v) => Math.round(v * 100), (v) => `${v.toFixed(2)}×`);
    const inv = $('set-invert');
    const showInv = () => { inv.setAttribute('aria-pressed', String(!!this.s.invertY)); inv.textContent = this.s.invertY ? 'On' : 'Off'; };
    showInv();
    onTap(inv, () => { this.s.invertY = !this.s.invertY; showInv(); this._changed(); });
    const fps = $('set-fps');
    const showFps = () => { fps.setAttribute('aria-pressed', String(!!this.s.showFps)); fps.textContent = this.s.showFps ? 'On' : 'Off'; };
    showFps();
    onTap(fps, () => { this.s.showFps = !this.s.showFps; showFps(); this._changed(); });
    const seg = $('set-tier');
    const showTier = () => {
      for (const b of seg.children) b.classList.toggle('on', b.dataset.tier === this.s.tier);
      const low = tierLow(this.s.tier), pending = low !== TIER.low;
      this.reloadBtn.classList.toggle('hidden', !pending);
      this.note.textContent = pending ? 'Resolution and draw distance changed now. Light pool: applies on restart (your game is saved first).'
        : `Graphics: ${low ? 'low' : 'high'}${this.s.tier === 'auto' ? ' (auto)' : ''}`;
    };
    showTier();
    onTap(seg, (b) => { this.s.tier = b.dataset.tier; showTier(); this._changed(); }, (t) => t.closest?.('[data-tier]'));
    onTap(this.reloadBtn, () => { this.save(); beforeReload?.(); location.reload(); });
    onTap($('settings-close'), () => this.close());
    this.apply(this.s);
  }
  _changed() { this.save(); this.apply(this.s); }
  save() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.s)); return true; } catch { return false; } }
  get isOpen() { return !this.el.classList.contains('hidden'); }
  open() { this.el.classList.remove('hidden'); }
  close() { this.el.classList.add('hidden'); this.onClose?.(); }
}
