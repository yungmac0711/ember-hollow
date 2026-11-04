// Wren's small requests (story/data/requests.json, DATA_FORMATS §3) — Chunk B.
// One active request at a time. A request is available once every `requires` is done AND its
// `unlockWhen` matches the world state (same rules as `when`). Wren offers the next one when Cam
// talks to her or idles near her; Cam completes it by talking to her (or "Give" in the tracker)
// while carrying the needs, which are consumed. Rewards: item → inventory, decoration → one
// placeable decor item in the pack, build_piece → unlocks that piece in the build palette.
import { STORY } from '../data/story.js';
import { matchWhen, fill } from './when.js';

export class Requests {
  constructor() {
    this.list = STORY.requests.requests || [];
    this.byId = Object.fromEntries(this.list.map((r) => [r.id, r]));
    this.done = new Set();
    this.active = null;     // request id
    this.unlocked = new Set(); // build_piece ids unlocked by rewards
    this.onChange = null;
  }

  /** Requests that could be offered now. */
  available(world) {
    return this.list.filter((r) => !this.done.has(r.id) && r.id !== this.active
      && (r.requires || []).every((id) => this.done.has(id))
      && matchWhen(r.unlockWhen, world) >= 0);
  }

  /** Offer the next available request if none is active. Returns the offer line (filled) or null. */
  offer(world, state) {
    if (this.active) return null;
    const r = this.available(world)[0];
    if (!r) return null;
    this.active = r.id; this.onChange?.();
    return fill(r.lines.offer, state);
  }

  get current() { return this.active ? this.byId[this.active] : null; }

  /** Have / need per item for the active request. */
  progress(inv) {
    const r = this.current; if (!r) return null;
    const rows = r.needs.map((n) => ({ item: n.item, need: n.count, have: Math.min(n.count, inv[n.item] || 0) }));
    return { r, rows, ready: rows.every((x) => x.have >= x.need) };
  }

  /** Try to complete the active request: consumes needs, grants the reward. */
  complete(inv, state) {
    const p = this.progress(inv);
    if (!p || !p.ready) return null;
    const r = p.r;
    for (const n of r.needs) inv[n.item] -= n.count;
    const rw = r.reward;
    if (rw.type === 'build_piece') this.unlocked.add(rw.id);
    else inv[rw.id] = (inv[rw.id] || 0) + (rw.count || 1);
    this.done.add(r.id); this.active = null; this.onChange?.();
    return { r, reward: rw, line: fill(r.lines.complete, state) };
  }

  progressLine(state) { const r = this.current; return r ? fill(r.lines.progress, state) : null; }

  serialize() { return { active: this.active, done: [...this.done], unlocked: [...this.unlocked] }; }
  restore(d) {
    if (!d) return;
    this.active = d.active && this.byId[d.active] ? d.active : null;
    this.done = new Set((d.done || []).filter((id) => this.byId[id]));
    this.unlocked = new Set(d.unlocked || []);
    this.onChange?.();
  }
}
