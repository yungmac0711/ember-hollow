// M2 chunk C: first-session tutorial hints. Each hint shows at most once (remembered in localStorage,
// across New Game), one at a time, in a small card at the top centre; it fades after a few seconds,
// hides as soon as Cam does the thing, and has a ✕ (onTap) to dismiss. Settings → Tutorial hints
// turns them off. No haptics.
import { onTap } from './tap.js';

export const HINTS_KEY = 'ember_hollow.hints_seen';
const touch = () => matchMedia('(pointer: coarse)').matches;
export const HINT_TEXT = {
  move: () => (touch() ? 'Drag on the left to walk, drag on the right to look around.' : 'WASD to walk, the mouse to look around.'),
  gather: () => (touch() ? 'Press and hold on a tree or rock (or hold Use) to gather.' : 'Hold Use (E) on a tree or rock to gather.'),
  campfire: () => 'You have enough for a fire: face open ground and tap Use, or 🛠 → Campfire.',
  bench: () => 'Next, a crafting bench: make it from 🛠, then place it from 🔨.',
  lantern: () => (touch() ? 'Tap the lantern slot to light or stow your lantern.' : 'Press L (or tap the lantern slot) to light or stow your lantern.'),
  journal: () => 'The Hearth Journal (📖, top right) shows what to do next.',
};

export class Coach {
  constructor({ enabled = () => true } = {}) {
    this.el = document.getElementById('coach'); this.txt = this.el.querySelector('.coach-text');
    this.enabled = enabled;
    try { this.seen = new Set(JSON.parse(localStorage.getItem(HINTS_KEY) || '[]')); } catch { this.seen = new Set(); }
    this.current = null; this.t = 0; this.cool = 0; this.shown = [];
    onTap(this.el.querySelector('.coach-x'), () => this.dismiss());
  }
  _save() { try { localStorage.setItem(HINTS_KEY, JSON.stringify([...this.seen])); } catch { /* private mode */ } }
  /** Show hint `id` if hints are on, it hasn't been shown before and nothing else is showing. */
  show(id, secs = 9) {
    if (!this.enabled() || this.seen.has(id) || this.current || this.cool > 0 || !HINT_TEXT[id]) return false;
    this.current = id; this.t = secs; this.seen.add(id); this.shown.push(id); this._save();
    this.txt.textContent = HINT_TEXT[id]();
    this.el.classList.add('show');
    return true;
  }
  /** Cam did the thing: hide it if it's up, and never show it later. */
  done(id) {
    if (!this.seen.has(id)) { this.seen.add(id); this._save(); }
    if (this.current === id) this.hide();
  }
  dismiss() { if (this.current) { this.hide(); this.dismissed = (this.dismissed || 0) + 1; } }
  hide() { this.current = null; this.cool = 2.5; this.el.classList.remove('show'); }
  setEnabled(on) { if (!on && this.current) this.hide(); }
  update(dt) {
    if (this.cool > 0) this.cool -= dt;
    if (this.current && (this.t -= dt) <= 0) this.hide();
  }
}
