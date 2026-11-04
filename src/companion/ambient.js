// Wren's unprompted remarks — Chunk B: driven by story/data/ambient_lines.json (via src/data/story.js).
// DATA_FORMATS §2: cooldowns come from the file (globalSec between any two lines, perTriggerSec
// before the same trigger fires again); each line may carry a `when` filter checked against the
// world state (same rules as replies: most specific tier wins); never repeat the last line used for
// that trigger; placeholders filled. A trigger blocked only by the global gap waits briefly.
// sayNow(text) speaks immediately, ignoring cooldowns (rare dig finds' wrenLine, request lines).
import { STORY } from '../data/story.js';
import { bestTier, fill } from './when.js';

export class AmbientLines {
  constructor({ holdPending = 20, getState = () => ({}) } = {}) {
    const cd = STORY.ambient.cooldowns || {};
    this.globalGap = cd.globalSec ?? 45; this.perTrigger = cd.perTriggerSec ?? 180; this.holdPending = holdPending;
    this.triggers = STORY.ambient.triggers || {};
    this.getState = getState;
    this.lastAt = -Infinity; this.lastByTrigger = {};
    this.triggerAt = {}; this.pending = null; this.time = 0;
    this.onLine = null; // (trigger, line) => void
    this.log = [];
  }

  has(trigger) { return !!this.triggers[trigger]; }

  /** Ask for a line. Returns the line if spoken now, otherwise null. */
  trigger(name, { force = false } = {}) {
    const pool = this.triggers[name];
    if (!pool) return null;
    if (force) return this._say(name, pool); // one-off milestones (shelter_complete) skip cooldowns
    if (this.time - (this.triggerAt[name] ?? -Infinity) < this.perTrigger) return null;
    if (this.time - this.lastAt < this.globalGap) { this.pending = { name, until: this.time + this.holdPending }; return null; }
    return this._say(name, pool);
  }

  _say(name, pool) {
    const state = this.getState();
    const world = state.world || state;
    let tier = bestTier(pool, world);
    if (!tier.length) return null;
    const last = this.lastByTrigger[name];
    if (tier.length > 1) tier = tier.filter((l) => l.text !== last);
    const pick = tier[Math.floor(Math.random() * tier.length)];
    this.lastByTrigger[name] = pick.text;
    this.triggerAt[name] = this.time;
    return this._emit(name, fill(pick.text, state));
  }

  /** Speak now, bypassing cooldowns. */
  sayNow(text, name = 'direct') {
    if (this.pending) this.pending = null;
    return this._emit(name, fill(text, this.getState()));
  }

  _emit(name, line) {
    this.lastAt = this.time;
    if (this.pending?.name === name) this.pending = null;
    this.log.push({ name, line, t: this.time }); if (this.log.length > 30) this.log.shift();
    this.onLine?.(name, line);
    return line;
  }

  update(dt) {
    this.time += dt;
    const p = this.pending;
    if (p && this.time > p.until) this.pending = null;
    else if (p && this.time - this.lastAt >= this.globalGap) { this.pending = null; this.trigger(p.name); }
  }
}
