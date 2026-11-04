// Wren's unprompted remarks for M0: fixed lines from story/COMPANION.md (via story-data.js).
// Rules: ≥45 s between any two lines, ≥3 min before the same trigger fires again, never repeat
// the last line. A trigger blocked only by the global gap waits briefly (newest wins).
import { AMBIENT_LINES } from './story-data.js';

export class AmbientLines {
  constructor({ globalGap = 45, perTrigger = 180, holdPending = 20 } = {}) {
    this.globalGap = globalGap; this.perTrigger = perTrigger; this.holdPending = holdPending;
    this.lastAt = -Infinity; this.lastLine = null;
    this.triggerAt = {}; this.pending = null; this.time = 0;
    this.onLine = null; // (trigger, line) => void
  }

  has(trigger) { return !!AMBIENT_LINES[trigger]; }

  /** Ask for a line. Returns the line if spoken now, otherwise null. */
  trigger(name) {
    const pool = AMBIENT_LINES[name];
    if (!pool) return null;
    if (this.time - (this.triggerAt[name] ?? -Infinity) < this.perTrigger) return null;
    if (this.time - this.lastAt < this.globalGap) { this.pending = { name, until: this.time + this.holdPending }; return null; }
    return this._say(name, pool);
  }

  _say(name, pool) {
    const options = pool.length > 1 ? pool.filter((l) => l !== this.lastLine) : pool;
    const line = options[Math.floor(Math.random() * options.length)];
    this.lastAt = this.time; this.lastLine = line; this.triggerAt[name] = this.time;
    if (this.pending?.name === name) this.pending = null;
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
