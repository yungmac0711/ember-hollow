// M1 inventory UI: thumb-friendly hotbar (6 resource slots + pack button), the build-mode piece
// palette (scrolls sideways), the pack panel, the storage-chest panel and the hold progress ring.
import { ITEM_INFO } from '../entities/items.js';
import { PIECES, PIECE_ORDER, costText, iconHtml } from '../build/pieces.js';

const $ = (id) => document.getElementById(id);
export const HOTBAR = ['wood', 'stone', 'flint', 'mushroom', 'glowcap', 'shard'];

function icon(kind) {
  const i = ITEM_INFO[kind];
  return iconHtml(i.img || i.icon);
}
const shortCost = (c) => Object.entries(c).map(([k, n]) => `${n}${k === 'wood' ? '🪵' : '🪨'}`).join(' ');

export class InventoryUI {
  constructor({ onSelectPiece, onStore, onTake, onPanel }) {
    this.hotbar = $('hotbar'); this.palette = $('palette'); this.ring = $('ring');
    this.bag = $('bag'); this.bagList = $('bag-list');
    this.chest = $('chestui'); this.chestPack = $('chest-pack'); this.chestStore = $('chest-store');
    this.ringFill = this.ring.querySelector('.fill'); this.ringIco = this.ring.querySelector('.ico');
    this.selected = 'wood'; this._last = {}; this.openPanel = null;
    this.onPanel = onPanel;
    const stop = (e) => { e.stopPropagation(); };
    // hotbar
    this.slots = {};
    for (const k of HOTBAR) {
      const b = document.createElement('button');
      b.className = 'slot'; b.dataset.kind = k; b.title = ITEM_INFO[k].label;
      b.innerHTML = `${icon(k)}<span class="n">0</span>`;
      b.addEventListener('pointerdown', (e) => { stop(e); e.preventDefault(); this.select(k); });
      this.hotbar.appendChild(b); this.slots[k] = b;
    }
    const bagBtn = document.createElement('button');
    bagBtn.className = 'slot bag'; bagBtn.id = 'btn-bag'; bagBtn.title = 'Pack'; bagBtn.textContent = '🎒';
    bagBtn.addEventListener('pointerdown', (e) => { stop(e); e.preventDefault(); this.toggleBag(); });
    this.hotbar.appendChild(bagBtn);
    this.select('wood');
    // palette
    this.pieceBtns = {};
    PIECE_ORDER.forEach((t, n) => {
      const b = document.createElement('button');
      b.className = 'slot has-cost'; b.dataset.piece = t; b.title = `${PIECES[t].name} · ${costText(PIECES[t].cost)} (${(n + 1) % 10})`;
      b.innerHTML = `${iconHtml(PIECES[t].icon)}<span class="c">${shortCost(PIECES[t].cost)}</span>`;
      b.addEventListener('click', (e) => { stop(e); onSelectPiece(t); });
      this.palette.appendChild(b); this.pieceBtns[t] = b;
    });
    // panels
    for (const el of document.querySelectorAll('.panel-close')) el.addEventListener('click', () => this.close());
    this.chestPack.addEventListener('click', (e) => { const k = e.target.closest('.slot')?.dataset.kind; if (k) onStore(k); });
    this.chestStore.addEventListener('click', (e) => { const k = e.target.closest('.slot')?.dataset.kind; if (k) onTake(k); });
  }

  select(kind) {
    this.selected = kind;
    for (const [k, b] of Object.entries(this.slots)) b.classList.toggle('sel', k === kind);
  }

  setInventory(inv) {
    for (const k of HOTBAR) {
      const n = inv[k] || 0;
      if (this._last[k] === n) continue;
      const b = this.slots[k];
      b.querySelector('.n').textContent = n;
      b.classList.toggle('empty', n === 0);
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
      b.classList.toggle('sel', t === selected);
      b.classList.toggle('cant', !Object.entries(PIECES[t].cost).every(([k, n]) => (inv[k] || 0) >= n));
    }
    const sb = this.pieceBtns[selected];
    if (sb && sb !== this._lastSel) { sb.scrollIntoView?.({ inline: 'nearest', block: 'nearest' }); this._lastSel = sb; }
  }

  // ---- panels
  toggleBag() { if (this.openPanel === 'bag') this.close(); else this.open('bag'); }
  open(name, data) {
    this.close(true);
    this.openPanel = name;
    if (name === 'bag') { this.bag.classList.remove('hidden'); this._renderBag(this._inv || {}); }
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
  _renderBag(inv) {
    const rows = Object.keys(ITEM_INFO).map((k) => `<div class="bag-row">${icon(k)}<span class="n">${inv[k] || 0}</span><span><b>${ITEM_INFO[k].label}</b><br><span class="d">${ITEM_INFO[k].desc || ''}</span></span></div>`).join('');
    if (this._bagHtml !== rows) { this.bagList.innerHTML = rows; this._bagHtml = rows; }
  }
  renderChest() {
    const d = this.chestData; if (!d) return;
    const cell = (k, n) => `<button class="slot${n ? '' : ' empty'}" data-kind="${k}" title="${ITEM_INFO[k].label}">${icon(k)}<span class="n">${n}</span></button>`;
    this.chestPack.innerHTML = Object.keys(ITEM_INFO).map((k) => cell(k, d.inv[k] || 0)).join('');
    this.chestStore.innerHTML = Object.keys(ITEM_INFO).map((k) => cell(k, d.store[k] || 0)).join('');
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
