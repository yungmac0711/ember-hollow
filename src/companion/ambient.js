// Wren's unprompted remarks — Chunk B: driven by story/data/ambient_lines.json (via src/data/story.js).
// DATA_FORMATS §2: cooldowns come from the file (globalSec between any two lines, perTriggerSec
// before the same trigger fires again); each line may carry a `when` filter checked against the
// world state (same rules as replies: most specific tier wins); never repeat the last line used for
// that trigger; placeholders filled. A trigger blocked only by the global gap waits briefly.
// sayNow(text) speaks immediately, ignoring cooldowns (rare dig finds' wrenLine, request lines).
// M2 chunk C: story/data/m2_lines.json triggers live here too, with their own cooldowns (globalSec 20 since
// ANY line, shared with ambient_lines; perTriggerSec 60). fish_bite ignores cooldowns. craft_success
// takes { category } (falls back to `any`); craft_first_time takes { recipe }; any trigger can take
// { line } to override the pool (a journal goal's own wrenLine beats the generic goal_complete line).
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
    const m2 = STORY.m2Lines || { triggers: {} };
    this.m2 = m2.triggers || {};
    this.m2Gap = m2.cooldowns?.globalSec ?? 20; this.m2Per = m2.cooldowns?.perTriggerSec ?? 60;
    this.noCooldown = new Set(['fish_bite']);
  }

  has(trigger) { return !!this.triggers[trigger] || !!this.m2[trigger]; }

  /** m2_lines pool for a trigger → [{text}] */
  _m2Pool(name, { category, recipe } = {}) {
    const t = this.m2[name];
    if (!t) return null;
    let list = t;
    if (name === 'craft_success') list = (category && t[category]?.length ? t[category] : t.any) || [];
    else if (name === 'craft_first_time') list = (recipe && t[recipe]) || [];
    else if (!Array.isArray(t)) list = t.any || [];
    return list.map((x) => (typeof x === 'string' ? { text: x } : x));
  }

  /** Ask for a line. Returns the line if spoken now, otherwise null. */
  trigger(name, opts = {}) {
    const { force = false, line = null } = opts;
    const m2 = !!this.m2[name];
    const pool = line ? [{ text: line }] : m2 ? this._m2Pool(name, opts) : this.triggers[name];
    if (!pool?.length) return null;
    if (force || this.noCooldown.has(name)) return this._say(name, pool); // one-off milestones (shelter_complete) skip cooldowns
    if (this.time - (this.triggerAt[name] ?? -Infinity) < (m2 ? this.m2Per : this.perTrigger)) return null;
    if (this.time - this.lastAt < (m2 ? this.m2Gap : this.globalGap)) { if (this.pending?.opts?.line && !line && this.time <= this.pending.until) return null; const gap = m2 ? this.m2Gap : this.globalGap; this.pending = { name, opts: { ...opts }, until: this.lastAt + gap + this.holdPending }; return null; } // held until the gap ends, then up to holdPending more
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
    else if (p && this.time - this.lastAt >= (this.m2[p.name] ? this.m2Gap : this.globalGap)) { this.pending = null; this.trigger(p.name, p.opts); }
  }
}
