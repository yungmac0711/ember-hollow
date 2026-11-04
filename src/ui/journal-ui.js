// M2 chunk C: the Hearth Journal panel (dark glass, same family as the craft panel). One page per
// chapter (locked chapters show a lock), goals with checkmarks and progress, plus a small "Home" page
// with the coziness score of the place Cam is in. Opened from the 📖 HUD button. Taps via onTap.
import { CHAPTERS } from '../progress/journal.js';
import { TIERS } from '../progress/coziness.js';
import { STORY } from '../data/story.js';
import { iconHtml, PIECES } from '../build/pieces.js';
import { onTap } from './tap.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CAT_NAME = { furniture: 'Furniture', light: 'Light', warmth: 'Warmth', decorations: 'Decorations', floor: 'Floor' };
const SCOPE = { shelter: 'In your shelter', hearth: 'By the fire', none: 'Out in the open' };
const label = (id) => PIECES[id]?.name || id.replace(/_/g, ' ');

export class JournalUI {
  /** { journal, getCozy() → coziness result, fill(text), onPanel(open) } */
  constructor({ journal, getCozy, fill = (t) => t, onPanel }) {
    this.j = journal; this.getCozy = getCozy; this.fill = fill; this.onPanel = onPanel;
    this.el = $('journalui'); this.tabsEl = $('journal-tabs'); this.body = $('journal-body');
    this.page = 0; this.isOpen = false;
    onTap(this.tabsEl, (p) => this.setPage(p), (el) => { const b = el.closest?.('[data-page]:not([disabled])'); return b ? b.dataset.page : null; });
    onTap(this.el.querySelector('.panel-close'), () => this.close());
  }
  open(page) {
    this.page = page ?? Math.min(this.j.ch, CHAPTERS.length - 1);
    this.isOpen = true; this.el.classList.remove('hidden'); this.render(); this.onPanel?.(true);
  }
  close() { if (!this.isOpen) return; this.isOpen = false; this.el.classList.add('hidden'); this.onPanel?.(false); }
  toggle() { if (this.isOpen) this.close(); else this.open(); }
  setPage(p) { this.page = p === 'home' ? 'home' : +p; this.render(); }
  render() {
    const j = this.j;
    const tabs = CHAPTERS.map((c, i) => {
      const open = j.started.has(c.id), done = i < j.ch;
      return `<button class="craft-tab jtab ${this.page === i ? 'sel' : ''} ${done ? 'done' : ''}" data-page="${i}" ${open ? '' : 'disabled'}>${open ? '' : iconHtml('ui_lock', 'sm')}${i + 1}</button>`;
    }).join('') + `<button class="craft-tab jtab ${this.page === 'home' ? 'sel' : ''}" data-page="home">${iconHtml('ui_coziness', 'sm')}Home</button>`;
    if (this._tabs !== tabs) { this.tabsEl.innerHTML = tabs; this._tabs = tabs; }
    const html = this.page === 'home' ? this._home() : this._chapter(CHAPTERS[this.page]);
    if (this._html !== html) { this.body.innerHTML = html; this._html = html; }
  }
  _chapter(c) {
    const j = this.j, i = CHAPTERS.indexOf(c), done = i < j.ch;
    const goals = c.goals.map((g) => {
      const ok = j.done.has(g.id), n = j.progress(g), cnt = g.count || 1;
      return `<div class="jgoal ${ok ? 'done' : ''}" data-goal="${g.id}">
        <span class="jchk">${ok ? iconHtml('ui_check', 'sm') : ''}</span>
        <div class="jmain"><div class="jtext">${esc(this.fill(g.text))}</div>${!ok && g.hint ? `<div class="jhint">${esc(this.fill(g.hint))}</div>` : ''}</div>
        <span class="jprog">${cnt > 1 && !ok ? `${n}/${cnt}` : ''}</span></div>`;
    }).join('');
    const rw = c.chapterReward ? `<div class="jreward">${done ? '✓ ' : ''}Chapter reward: ${esc(label(c.chapterReward.id))}</div>` : '';
    const cz = this.getCozy?.();
    const cozyLine = cz ? `<div class="jcozy">${iconHtml('ui_coziness', 'sm')} ${SCOPE[cz.scope] || ''}: ${esc(TIERS[cz.tier].name)} · coziness ${cz.score}</div>` : '';
    return `<div class="jhead"><div class="jtitle">Chapter ${i + 1} · ${esc(c.title)}</div>
      <div class="jintro">“${esc(this.fill(done && c.outro ? c.outro : c.intro))}”</div></div>
      <div class="jgoals">${goals}</div>${rw}${cozyLine}`;
  }
  _home() {
    const cz = this.getCozy?.() || { scope: 'none', score: 0, tier: 0, cats: {} };
    const C = STORY.coziness.categories;
    const next = TIERS[cz.tier + 1];
    const bars = Object.entries(C).map(([k, d]) => {
      const v = cz.cats[k] || 0;
      return `<div class="jbar"><span>${CAT_NAME[k] || k}</span><div class="bar"><div class="fill" style="width:${Math.round(v / d.cap * 100)}%"></div></div><span class="jbv">${v}/${d.cap}</span></div>`;
    }).join('');
    const best = TIERS[this.j.cozyBest];
    return `<div class="jhead"><div class="jtitle">${esc(SCOPE[cz.scope])}: ${esc(TIERS[cz.tier].name)}</div>
      <div class="jintro">Coziness ${cz.score}${next ? ` · ${next.name} at ${next.minScore}` : ''}. Best so far: ${esc(best.name)}.</div></div>
      <div class="jbars">${bars}</div>
      <div class="jhint jfoot">Only the first two of each piece count. Keep a fire lit for extra warmth.</div>`;
  }
}

