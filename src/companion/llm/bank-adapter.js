// Offline reply bank (default, Chunk B): story/data/wren_replies.json matched exactly as
// story/DATA_FORMATS.md §1 says. No network, no key. The summarizer is the stub's (offline).
//  1. lowercase; keep <3 :) :( :d (checked BEFORE punctuation is stripped); strip punctuation; collapse spaces
//  2. intent score = keyword hits (single word → whole token, multi-word → substring of the normalized text)
//  3. highest score, ties → higher priority; nothing > 0 → fallback
//  4. filter replies by `when` (missing state key = no match); most specific tier wins, else unconditional
//  5. weighted random within the tier, skipping the last 5 reply texts used (relaxed if nothing is left)
//  6. fill {{player}} {{biscuit}} {{area}} {{dayCount}}
import { StubAdapter } from './stub-adapter.js';
import { STORY } from '../../data/story.js';
import { bestTier, weighted, fill } from '../when.js';

const EMOTICONS = ['<3', ':)', ':(', ':d'];
const EMO_TOKEN = { '<3': ' emoheart ', ':)': ' emosmile ', ':(': ' emofrown ', ':d': ' emogrin ' };

/** Normalize text into {str, tokens}. Emoticons survive as their own tokens. */
export function normalize(text) {
  let s = ` ${String(text).toLowerCase()} `;
  for (const e of EMOTICONS) s = s.split(e).join(EMO_TOKEN[e]);
  s = s.replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return s;
}
const normKeyword = (k) => (EMOTICONS.includes(k.toLowerCase()) ? EMO_TOKEN[k.toLowerCase()].trim() : normalize(k));

export class ReplyBank {
  constructor(data = STORY.replies) {
    this.fallback = data.fallback;
    this.intents = data.intents.map((it) => ({ ...it, kw: it.keywords.map(normKeyword).filter(Boolean) }));
    this.recent = [];
  }
  /** Best intent for a message, or null → fallback. */
  intent(message) {
    const str = normalize(message), tokens = new Set(str.split(' ')), padded = ` ${str} `;
    let best = null, bs = 0;
    for (const it of this.intents) {
      let score = 0;
      for (const k of it.kw) score += k.includes(' ') ? (padded.includes(k) ? 1 : 0) : (tokens.has(k) ? 1 : 0);
      if (score > bs || (score === bs && score > 0 && it.priority > best.priority)) { best = it; bs = score; }
    }
    return bs > 0 ? best : null;
  }
  pick(message, state) {
    const it = this.intent(message);
    const pool = it ? it.replies : this.fallback;
    let tier = bestTier(pool, state);
    if (!tier.length) tier = pool.filter((r) => !r.when);
    const fresh = tier.filter((r) => !this.recent.includes(r.text));
    const r = weighted(fresh.length ? fresh : tier);
    this.recent.push(r.text); if (this.recent.length > 5) this.recent.shift();
    return { intent: it?.id || 'fallback', text: fill(r.text, state) };
  }
}

export class BankAdapter extends StubAdapter {
  constructor() { super(); this.bank = new ReplyBank(); this.last = null; }
  get id() { return 'bank'; }
  async reply({ message, state }) {
    await new Promise((r) => setTimeout(r, 350 + Math.random() * 450)); // "thinking"
    const s = { ...(state.world || {}), playerName: state.playerName, areaName: state.location, dayCount: state.world?.dayCount };
    this.last = this.bank.pick(message, s);
    return this.last.text;
  }
}
