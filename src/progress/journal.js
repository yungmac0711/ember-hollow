// M2 chunk C: the Hearth Journal (story/data/hearth_journal.json, DATA_FORMATS §11).
// Chapters run in order; goals inside a chapter in any order. Event goals (craft, cook, gather, pet,
// sleep, fish, visit) count from when their chapter starts; state goals (place/build pieces,
// coziness tier, holdItem, being in an area) are checked live, so placed pieces count only while
// they exist. Completing a goal applies its reward (recipe unlock, item/decoration into the pack,
// or a dialogue Wren says next time Cam is near her). Finishing every goal grants the chapter
// reward and starts the next chapter. Also owns the real recipe gating (replaces chunk B's stopgap).
import { STORY } from '../data/story.js';
import { COZY_TIERS } from '../data/recipes.js';

const J = STORY.journal;
/** recipe/goal ids → build piece types (window_wall → window, bed_roll → bedroll) */
const PIECE_KEY = { bed_roll: 'bedroll', window_wall: 'window' };
const TIER_IDX = Object.fromEntries(COZY_TIERS.map((t, i) => [t.id, i]));
const EVENT_TYPES = new Set(['craft', 'cook', 'gather', 'pet', 'sleep', 'fish', 'visit']);
const targets = (g) => (Array.isArray(g.target) ? g.target : [g.target]);

export const CHAPTERS = J.chapters;
export const DIALOGUES = J.dialogues || {};
export const GOALS = Object.fromEntries(J.chapters.flatMap((c) => c.goals.map((g) => [g.id, { ...g, chapter: c.id }])));

export class Journal {
  constructor() {
    this.onGoal = null;    // (goal, chapter) => void
    this.onChapter = null; // (chapter, next|null) => void
    this.onReward = null;  // (reward, source) => void  (items / decorations go into the pack)
    this.reset();
  }
  reset() {
    this.ch = 0;                 // index of the active chapter (=== CHAPTERS.length when all done)
    this.started = new Set([CHAPTERS[0].id]);
    this.done = new Set();       // goal ids
    this.prog = {};              // goal id → count (event goals) / live count (state goals)
    this.unlocked = new Set();   // recipe ids unlocked by rewards
    this.dialogues = [];         // pending dialogue ids
    this.cozyBest = 0;           // highest coziness tier index ever reached (gates coziness: recipes)
    this.crafted = new Set();    // recipe ids crafted at least once (craft_first_time lines)
    this.openAreas = new Set();  // 'emberdeep' once g5_hold completes (chunk E builds the area)
    this.log = [];
  }
  get chapter() { return CHAPTERS[this.ch] || null; }
  get complete() { return this.ch >= CHAPTERS.length; }
  chapterIndex(id) { return CHAPTERS.findIndex((c) => c.id === id); }

  /** An event happened (craft stone_axe, gather wood ×2 …). Returns the goals it completed. */
  emit(type, target, n = 1) {
    const c = this.chapter; if (!c) return [];
    const out = [];
    for (const g of c.goals) {
      if (this.done.has(g.id) || g.type !== type || !targets(g).includes(target)) continue;
      this.prog[g.id] = (this.prog[g.id] || 0) + n;
      if (this.prog[g.id] >= (g.count || 1)) out.push(this._complete(g));
    }
    if (out.length) this._checkChapter();
    return out;
  }

  /** Live state goals. ctx: { counts: {pieceType: n}, holding, area, cozyTier } */
  update(ctx) {
    const c = this.chapter; if (!c) return [];
    const out = [];
    for (const g of c.goals) {
      if (this.done.has(g.id) || EVENT_TYPES.has(g.type) && g.type !== 'visit') continue;
      let n = 0;
      if (g.type === 'place' || g.type === 'build') n = targets(g).reduce((s, t) => s + (ctx.counts?.[PIECE_KEY[t] || t] || 0), 0);
      else if (g.type === 'coziness') n = (ctx.cozyTier ?? -1) >= (TIER_IDX[g.target] ?? 99) ? 1 : 0;
      else if (g.type === 'holdItem') n = targets(g).includes(ctx.holding) ? 1 : 0;
      else if (g.type === 'visit') n = targets(g).includes(ctx.area) ? 1 : 0;
      this.prog[g.id] = n;
      if (n >= (g.count || 1)) out.push(this._complete(g));
    }
    if (out.length) this._checkChapter();
    return out;
  }

  progress(g) { return this.done.has(g.id) ? g.count || 1 : Math.min(g.count || 1, this.prog[g.id] || 0); }

  _complete(g) {
    this.done.add(g.id); this.prog[g.id] = g.count || 1;
    const r = g.reward;
    if (r?.type === 'recipe') this.unlocked.add(r.id);
    else if (r?.type === 'dialogue') this.dialogues.push(r.id);
    else if (r) this.onReward?.(r, g);
    if (g.id === 'g5_hold') this.openAreas.add('emberdeep'); // DATA_FORMATS §11: the gate opens when g5_visit is next
    if (g.unlockArea && this.done.has(g.id)) this.openAreas.add(g.unlockArea);
    this.log.push(g.id);
    this.onGoal?.(g, this.chapter);
    return g;
  }
  _checkChapter() {
    const c = this.chapter;
    if (!c || !c.goals.every((g) => this.done.has(g.id))) return;
    if (c.chapterReward) this.onReward?.(c.chapterReward, c);
    this.ch++;
    const next = this.chapter;
    if (next) this.started.add(next.id);
    this.onChapter?.(c, next);
  }

  /** Recipe gating → { ok, hint }. */
  unlockState(r) {
    if (r.station === 'forge') return { ok: false, hint: 'Found deep below' }; // chunk E: the Emberdeep forge
    if (this.unlocked.has(r.id)) return { ok: true };
    const u = r.unlock || 'default';
    if (u === 'default') return { ok: true };
    if (u.startsWith('chapter:')) {
      const id = u.slice(8), i = this.chapterIndex(id);
      return this.started.has(id) ? { ok: true } : { ok: false, hint: `Journal: chapter ${i + 1}, ${CHAPTERS[i]?.title || id}` };
    }
    if (u.startsWith('coziness:')) {
      const i = TIER_IDX[u.slice(9)];
      if (i == null || this.cozyBest >= i) return { ok: true };
      return { ok: false, hint: `When your home feels like a ${COZY_TIERS[i].name}` };
    }
    const g = GOALS[u];
    if (!g) return { ok: true };
    return this.done.has(u) ? { ok: true } : { ok: false, hint: `Journal: ${g.text.replace('{{biscuit}}', 'Biscuit')}` };
  }

  serialize() {
    return { v: 1, ch: this.ch, started: [...this.started], done: [...this.done], prog: { ...this.prog }, unlocked: [...this.unlocked],
      dialogues: [...this.dialogues], cozyBest: this.cozyBest, crafted: [...this.crafted], openAreas: [...this.openAreas] };
  }
  restore(d) {
    this.reset();
    if (!d) return;
    this.ch = Math.min(CHAPTERS.length, d.ch | 0);
    this.started = new Set(d.started?.length ? d.started : [CHAPTERS[0].id]);
    this.done = new Set(d.done || []); this.prog = { ...(d.prog || {}) };
    this.unlocked = new Set(d.unlocked || []); this.dialogues = [...(d.dialogues || [])];
    this.cozyBest = d.cozyBest | 0; this.crafted = new Set(d.crafted || []); this.openAreas = new Set(d.openAreas || []);
  }
}
