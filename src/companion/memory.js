// Wren's long-term memory, stored on the phone in localStorage (story/companion_system_prompt.md
// "Memory Rules"). Key and schema are locked. Summaries run every 30 chat messages and at session end.
import { CONFIG } from '../config.js';

export const MEMORY_KEY = 'ember_hollow.companion_memory';
export const SUMMARY_INSTRUCTION =
  'Summarize this session in <=200 characters as neutral facts; list up to 3 new facts as JSON. ' +
  'Respond as {"summary": "...", "facts": [{"type": "preference|milestone|find|moment|promise", "text": "...", "weight": 1}]}';

const MAX_FACTS = 50, MAX_SUMMARIES = 10, MAX_SUMMARY_CHARS = 600;

function localISO(d = new Date()) {
  const off = -d.getTimezoneOffset(), sign = off >= 0 ? '+' : '-', pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

function blank() {
  return {
    version: 1,
    player_name: CONFIG.playerName,
    facts: [],
    session_summaries: [],
    memory_summary: '',
    // engine bookkeeping (not sent to the model verbatim)
    session_count: 0,
    recent_turns: [],
  };
}

export class CompanionMemory {
  constructor(adapter, storage = globalThis.localStorage) {
    this.adapter = adapter;
    this.storage = storage;
    this.data = this._load();
    this.data.session_count += 1;
    this.session = this.data.session_count;
    this.transcript = [];          // this session's messages since the last summary
    this.messagesSinceSummary = 0;
    this._summarizing = false;
    this._save();
  }

  _load() {
    try {
      const raw = this.storage?.getItem(MEMORY_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.version === 1) return { ...blank(), ...d };
      }
    } catch (e) { console.warn('[memory] could not read memory, starting fresh', e); }
    return blank();
  }

  _save() {
    try { this.storage?.setItem(MEMORY_KEY, JSON.stringify(this.data)); } catch (e) { console.warn('[memory] save failed', e); }
  }

  get isFirstMeeting() { return this.data.session_count <= 1 && this.data.recent_turns.length === 0; }

  /** Short-term history sent verbatim (last N turns). */
  history() { return this.data.recent_turns.slice(-CONFIG.companion.historyTurns * 2); }

  /** Record one chat message ('user' = Cam, 'assistant' = Wren). */
  addMessage(role, content) {
    const msg = { role, content };
    this.transcript.push(msg);
    this.data.recent_turns.push(msg);
    this.data.recent_turns = this.data.recent_turns.slice(-CONFIG.companion.historyTurns * 2);
    this.messagesSinceSummary += 1;
    this._save();
    if (this.messagesSinceSummary >= CONFIG.companion.summarizeEvery) this.summarize('30 messages');
  }

  /** Game-side facts (milestones, finds). Deduped by text. */
  addFact(type, text, weight = 2) {
    if (this.data.facts.some((f) => f.text === text)) return false;
    this.data.facts.push({ id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, type, text, created: localISO(), weight });
    this._capFacts();
    this._rebuildSummary();
    this._save();
    return true;
  }

  hasFact(text) { return this.data.facts.some((f) => f.text === text); }

  _capFacts() {
    const f = this.data.facts;
    while (f.length > MAX_FACTS) {
      // drop lowest weight / oldest first; milestones & promises at weight 3 go last
      let worst = 0;
      const rank = (x) => (x.weight >= 3 && (x.type === 'milestone' || x.type === 'promise') ? 10 : x.weight);
      for (let i = 1; i < f.length; i++) if (rank(f[i]) < rank(f[worst])) worst = i;
      f.splice(worst, 1);
    }
  }

  _rebuildSummary() {
    const facts = [...this.data.facts].sort((a, b) => b.weight - a.weight || (a.created < b.created ? 1 : -1));
    const parts = [`Player is ${this.data.player_name}.`];
    for (const s of this.data.session_summaries.slice(-3)) parts.push(s.text);
    for (const f of facts) parts.push(f.text.endsWith('.') ? f.text : f.text + '.');
    let out = '';
    for (const p of parts) { if ((out + ' ' + p).trim().length > MAX_SUMMARY_CHARS) break; out = (out + ' ' + p).trim(); }
    this.data.memory_summary = out;
  }

  /**
   * Summary pass. Reasons: '30 messages' | 'session end'. Safe to call repeatedly; no-op when
   * nothing new was said. The stub adapter resolves synchronously-fast so it survives pagehide.
   */
  async summarize(reason = 'manual') {
    if (this._summarizing || this.transcript.length === 0) return null;
    this._summarizing = true;
    const transcript = this.transcript.splice(0);
    this.messagesSinceSummary = 0;
    try {
      const res = await this.adapter.summarize({ transcript, memory: this.data, instruction: SUMMARY_INSTRUCTION, reason });
      if (res?.summary) {
        const ss = this.data.session_summaries;
        ss.push({ session: this.session, date: localISO().slice(0, 10), text: res.summary.slice(0, 200) });
        while (ss.length > MAX_SUMMARIES) {
          const [a, b] = ss.splice(0, 2);
          ss.unshift({ session: 0, date: b.date, text: `Earlier: ${a.text} ${b.text}`.slice(0, 200) });
        }
      }
      for (const f of res?.facts || []) if (f?.text) this.addFact(f.type || 'moment', f.text, Math.min(3, Math.max(1, f.weight || 1)));
      this._rebuildSummary();
      this._save();
      return res;
    } catch (e) {
      console.warn('[memory] summarize failed', e);
      this.transcript.unshift(...transcript);
      return null;
    } finally { this._summarizing = false; }
  }

  /** Start a fresh session (after the old one ended by backgrounding or idling). */
  newSession() {
    this.data.session_count += 1;
    this.session = this.data.session_count;
    this._save();
  }
}
