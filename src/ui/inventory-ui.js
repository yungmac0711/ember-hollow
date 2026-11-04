// M1 inventory UI: thumb-friendly hotbar (resource slots + Biscuit's stick + pack button), the
// build-mode piece palette (scrolls sideways, shows only unlocked/owned pieces), the pack panel
// (resources, decorations, keepsakes, journal), the storage-chest panel and the hold progress ring.
// Tooltips (item_flavor.json / biscuit_finds.json lines) pop above the bar when a slot is tapped.
import { ITEM_INFO } from '../entities/items.js';
import { onTap } from './tap.js';
import { PIECES, PIECE_ORDER, KEEPSAKES, costText, iconHtml } from '../build/pieces.js';

const $ = (id) => document.getElementById(id);
export const HOTBAR = ['wood', 'stone', 'flint', 'mushroom', 'glowcap', 'crystal_shard', 'stew'];
// M2 chunk A: the slim hotbar only shows what Cam carries (wood/stone/flint keep a ghost slot)
const ALWAYS = new Set(['wood', 'stone', 'flint']);
const IDLE_MS = 4000; // then the bar fades to .45 until touched or the pack changes
export const DECOR = PIECE_ORDER.filter((t) => PIECES[t].decor);
const STORABLE = () => [...Object.keys(ITEM_INFO), ...DECOR, ...KEEPSAKES.map((k) => k.id)];

const label = (k) => ITEM_INFO[k]?.label || PIECES[k]?.name || k;
const desc = (k) => ITEM_INFO[k]?.desc || PIECES[k]?.flavor || '';
function icon(kind) {
  const i = ITEM_INFO[kind];
  return iconHtml(i ? (i.img || i.icon) : PIECES[kind]?.icon || '•');
}
const RES_ICON = { wood: '🪵', stone: '🪨', crystal_shard: '💎', flint: '✦' };
const shortCost = (c) => Object.entries(c).map(([k, n]) => (PIECES[k] ? `×${n}` : `${n}${RES_ICON[k] || k[0]}`)).join(' ');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class InventoryUI {
  constructor({ onSelectPiece, onStore, onTake, onPanel, onStick, onSelect, onReadNote, isAvailable, onLantern }) {
    this.hotbar = $('hotbar'); this.palette = $('palette'); this.ring = $('ring');
    this.bag = $('bag'); this.bagList = $('bag-list');
    this.chest = $('chestui'); this.chestPack = $('chest-pack'); this.chestStore = $('chest-store');
    this.tip = $('tip');
    this.ringFill = this.ring.querySelector('.fill'); this.ringIco = this.ring.querySelector('.ico');
    this.selected = 'wood'; this._last = {}; this.openPanel = null;
    this.onPanel = onPanel; this.onSelect = onSelect; this.onReadNote = onReadNote; this.onEat = null;
    this.isAvailable = isAvailable || ((t) => !PIECES[t].locked && !PIECES[t].decor && !PIECES[t].keepsake);
    this.journal = []; // [{id, title}]
    const stop = (e) => { e.stopPropagation(); };
    // hotbar: Cam's hand lantern first (tap: light / stow; empty ring = lost, tap to make one)
    this.slots = {};
    const lb = document.createElement('button');
    lb.className = 'slot lantern on'; lb.dataset.kind = 'hand_lantern'; lb.id = 'slot-lantern';
    lb.title = `${label('hand_lantern')} · ${desc('hand_lantern')} (L)`;
    lb.innerHTML = `${icon('hand_lantern')}`;
    lb.addEventListener('pointerdown', (e) => { stop(e); e.preventDefault(); this.wake(); onLantern?.(); });
    this.hotbar.appendChild(lb); this.lanternBtn = lb;
    for (const k of HOTBAR) {
      const b = document.createElement('button');
      b.className = 'slot'; b.dataset.kind = k; b.title = `${label(k)} · ${desc(k)}`;
      b.innerHTML = `${icon(k)}<span class="n">0</span>`;
      // Chunk C: tapping the stew slot again once it's selected eats a bowl (pointerdown, never click — iOS)
      b.addEventListener('pointerdown', (e) => {
        stop(e); e.preventDefault(); this.wake();
        const again = this.selected === k; this.select(k);
        if (again && k === 'stew') this.onEat?.(); else this.showTip(k, b);
      });
      this.hotbar.appendChild(b); this.slots[k] = b;
    }
    // Biscuit's stick: a free hotbar action (not the wood item) — tap to throw
    const stick = document.createElement('button');
    stick.className = 'slot action'; stick.id = 'btn-stick'; stick.title = 'Throw a stick for Biscuit (G)';
    stick.innerHTML = `${iconHtml('stick')}<span class="cd"></span>`;
    stick.addEventListener('pointerdown', (e) => { stop(e); e.preventDefault(); this.wake(); onStick?.(); });
    this.hotbar.appendChild(stick); this.stickBtn = stick;
    // the pack button lives in the top-right column now (index.html #hud-col)
    const bagBtn = $('btn-bag');
    bagBtn.title = 'Pack (I)'; bagBtn.innerHTML = iconHtml('ui_inventory');
    bagBtn.addEventListener('pointerdown', (e) => { stop(e); e.preventDefault(); this.toggleBag(); });
    this._wakeT = 0; this.wake();
    this._idleIv = setInterval(() => this.hotbar.classList.toggle('idle', performance.now() - this._wakeT > IDLE_MS), 500);
    this.select('wood');
    // palette
    this.pieceBtns = {};
    PIECE_ORDER.forEach((t) => {
      const b = document.createElement('button');
      b.className = 'slot has-cost hidden'; b.dataset.piece = t;
      b.title = `${PIECES[t].name} · ${costText(PIECES[t].cost)}${PIECES[t].flavor ? ' · ' + PIECES[t].flavor : ''}`;
      b.innerHTML = `${iconHtml(PIECES[t].icon)}<span class="c">${shortCost(PIECES[t].cost)}</span>`;
      this.palette.appendChild(b); this.pieceBtns[t] = b;
    });
    // one delegated tap handler on the (sideways-scrolling) palette: pointerup + movement slop,
    // so a swipe scrolls and a tap selects (iOS drops 'click' here — see tap.js, hotfix 36d7f5e)
    onTap(this.palette, (t) => { onSelectPiece(t); this.showTip(t, this.pieceBtns[t], true); }, (el) => el.closest?.('.slot')?.dataset.piece || null);
    // panels
    for (const el of document.querySelectorAll('#bag .panel-close, #chestui .panel-close')) onTap(el, () => this.close());
    const kindOf = (el) => el.closest?.('.slot')?.dataset.kind || null;
    onTap(this.chestPack, (k) => onStore(k), kindOf);
    onTap(this.chestStore, (k) => onTake(k), kindOf);
    onTap(this.bagList, (id) => onReadNote?.(id), (el) => el.closest?.('[data-note]')?.dataset.note || null);
  }

  showTip(k, el, piece = false) {
    if (!this.tip) return;
    const name = piece ? PIECES[k].name : label(k), d = piece ? PIECES[k].flavor : desc(k);
    if (!d) return;
    this.tip.innerHTML = `<b>${esc(name)}</b> · ${esc(d)}`;
    const r = el.getBoundingClientRect();
    this.tip.style.left = `${Math.round(r.left + r.width / 2)}px`;
    this.tip.style.bottom = `${Math.round(window.innerHeight - r.top + 8)}px`;
    this.tip.classList.add('show');
    clearTimeout(this._tipT); this._tipT = setTimeout(() => this.tip.classList.remove('show'), 2200);
  }

  select(kind) {
    this.selected = kind;
    for (const [k, b] of Object.entries(this.slots)) b.classList.toggle('sel', k === kind);
    this.onSelect?.(kind);
  }
  setStickOut(out) {
    // cooldown: the hatched overlay, masked by a conic sweep (--cd 1 → 0) while Biscuit has the stick
    if (out && !this._stickT) this._stickT = performance.now();
    if (!out) this._stickT = 0;
    const cd = out ? Math.max(0.12, 1 - (performance.now() - this._stickT) / 9000) : 0;
    if (this._cd !== cd.toFixed(2)) { this._cd = cd.toFixed(2); this.stickBtn.style.setProperty('--cd', this._cd); }
    this.stickBtn.classList.toggle('cant', !!out);
  }
  /** Lit / stowed / lost (lost = ghost ring; tapping makes a new one). */
  setLantern(lit, has) {
    const key = `${lit}|${has}`; if (this._lk === key) return; this._lk = key;
    this.lanternBtn.classList.toggle('on', !!lit && !!has);
    this.lanternBtn.classList.toggle('empty', !has);
    if (this._lkInit) this.wake(); this._lkInit = true;
  }
  /** Any touch on the bar or a change in the pack brings it back to full opacity. */
  wake() { this._wakeT = performance.now(); this.hotbar.classList.remove('idle'); }

  setInventory(inv) {
    for (const k of HOTBAR) {
      const n = inv[k] || 0;
      if (this._last[k] === n) continue;
      const b = this.slots[k];
      b.querySelector('.n').textContent = n > 99 ? '99+' : n;
      b.classList.toggle('empty', n === 0);
      if (!ALWAYS.has(k)) b.classList.toggle('hidden', n === 0);
      if (this._last[k] !== undefined) this.wake();
      if (this._last[k] !== undefined && n > this._last[k]) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
      this._last[k] = n;
    }
    if (this.openPanel === 'bag') this._renderBag(inv);
  }

  setBuildMode(on, selected, inv) {
    this.hotbar.classList.toggle('hidden', on);
    this.palette.classList.toggle('hidden', !on);
    document.body.classList.toggle('building', on);
    if (on) this.setPalette(selected, inv);
  }
  setPalette(selected, inv) {
    for (const [t, b] of Object.entries(this.pieceBtns)) {
      const avail = this.isAvailable(t, inv);
      b.classList.toggle('hidden', !avail);
      if (!avail) continue;
      b.classList.toggle('sel', t === selected);
      b.classList.toggle('cant', !Object.entries(PIECES[t].cost).every(([k, n]) => (inv[k] || 0) >= n));
      if (PIECES[t].decor || PIECES[t].keepsake) { const c = b.querySelector('.c'); const n = `×${inv[t] || 0}`; if (c.textContent !== n) c.textContent = n; }
    }
    const sb = this.pieceBtns[selected];
    if (sb && sb !== this._lastSel) { sb.scrollIntoView?.({ inline: 'nearest', block: 'nearest' }); this._lastSel = sb; }
  }
  /** Palette order for number keys: only what's visible. */
  visiblePieces(inv) { return PIECE_ORDER.filter((t) => this.isAvailable(t, inv)); }

  // ---- panels
  toggleBag() { if (this.openPanel === 'bag') this.close(); else this.open('bag'); }
  open(name, data) {
    this.close(true);
    this.openPanel = name;
    if (name === 'bag') { this.bag.classList.remove('hidden'); this._bagHtml = null; this._renderBag(this._inv || {}); }
    if (name === 'chest') { this.chest.classList.remove('hidden'); this.chestData = data; this.renderChest(); }
    this.onPanel?.(name);
  }
  close(silent = false) {
    if (!this.openPanel) return;
    const was = this.openPanel;
    this.bag.classList.add('hidden'); this.chest.classList.add('hidden');
    this.openPanel = null;
    if (!silent) this.onPanel?.(null, was, this.chestData);
    this.chestData = null;
  }
  bindInventory(inv) { this._inv = inv; }
  _row(k, n) {
    return `<div class="bag-row" data-kind="${k}">${icon(k)}<span class="n">${n}</span><span><b>${esc(label(k))}</b><br><span class="d">${esc(desc(k))}</span></span></div>`;
  }
  _renderBag(inv) {
    let rows = Object.keys(ITEM_INFO).filter((k) => k !== 'stew' || inv.stew).map((k) => this._row(k, inv[k] || 0)).join('');
    const dec = DECOR.filter((k) => inv[k] > 0), ks = KEEPSAKES.filter((k) => inv[k.id] > 0).map((k) => k.id);
    if (dec.length) rows += `<div class="bag-sec">Decorations · place them from 🔨</div>` + dec.map((k) => this._row(k, inv[k])).join('');
    if (ks.length) rows += `<div class="bag-sec">Keepsakes · set them on a table or chest</div>` + ks.map((k) => this._row(k, inv[k])).join('');
    rows += `<div class="bag-sec">Journal</div>` + (this.journal.length
      ? this.journal.map((j) => `<button class="journal-row" data-note="${j.id}">📜 ${esc(j.title)}</button>`).join('')
      : `<div class="d journal-empty">No notes yet. Keep an eye out for paper and slate.</div>`);
    if (this._bagHtml !== rows) { this.bagList.innerHTML = rows; this._bagHtml = rows; }
  }
  setJournal(list) { this.journal = list; this._bagHtml = null; if (this.openPanel === 'bag') this._renderBag(this._inv || {}); }
  renderChest() {
    const d = this.chestData; if (!d) return;
    const keys = STORABLE();
    const cell = (k, n) => `<button class="slot${n ? '' : ' empty'}" data-kind="${k}" title="${esc(label(k))}">${icon(k)}<span class="n">${n}</span></button>`;
    this.chestPack.innerHTML = keys.filter((k) => d.inv[k] > 0 || ITEM_INFO[k]?.pickup).map((k) => cell(k, d.inv[k] || 0)).join('');
    this.chestStore.innerHTML = keys.filter((k) => d.store[k] > 0 || ITEM_INFO[k]?.pickup).map((k) => cell(k, d.store[k] || 0)).join('');
  }

  // ---- progress ring
  setRing(p, x, y, ico) {
    if (p == null) { this.ring.classList.add('hidden'); return; }
    this.ring.classList.remove('hidden');
    this.ring.style.left = x + 'px'; this.ring.style.top = y + 'px';
    this.ringFill.style.setProperty('--p', Math.min(1, p).toFixed(3));
    if (this.ringIco.textContent !== ico) this.ringIco.textContent = ico;
  }
}
