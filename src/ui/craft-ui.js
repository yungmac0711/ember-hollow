// M2 chunk B: the crafting panel (dark glass, same family as the pack). Opened from the HUD craft
// button (hand recipes anywhere), by using a placed crafting bench (bench recipes) or a cooking pot
// next to a lit fire (cooking-pot recipes). Tabs follow recipes.json categories. All taps go through
// onTap (pointer-based; iOS drops 'click').
//
// Unlock stopgap until chunk C (goals/chapters): goal (`g*_`) and `chapter:` unlocks count as
// unlocked; `coziness:` unlocks are unlocked only for a tier with minScore 0 (cold_camp) and
// otherwise show a lock with the tier's name; forge recipes are locked ("found deep below", chunk E).
import { RECIPES, COZY_TIERS } from '../data/recipes.js';
import { ITEM_INFO } from '../entities/items.js';
import { PIECES, RECIPE_PIECE, iconHtml } from '../build/pieces.js';
import { onTap } from './tap.js';

const $ = (id) => document.getElementById(id);
export const TABS = [['tools', 'Tools'], ['building', 'Building'], ['cozy', 'Cozy'], ['food', 'Food'], ['light', 'Light']];
const STATION_NAME = { hand: 'By hand', bench: 'Crafting bench', cooking_pot: 'Cooking pot', forge: 'Forge' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const itemLabel = (k) => ITEM_INFO[k]?.label || PIECES[k]?.name?.toLowerCase() || k.replace(/_/g, ' ');
const ICON = { campfire: '🔥', crystal_waylamp: 'waylamp' };

/** The pack key a recipe's output lands in (window_wall → window, bed_roll → bedroll). */
export const outKey = (r) => RECIPE_PIECE[r.output.id] || r.output.id;
/** Extra ingredients the game adds on top of recipes.json (the waylamp is made FROM the hand lantern). */
export function ingredientsOf(r) {
  const list = r.ingredients.map((i) => ({ item: i.item, count: i.count }));
  if (r.id === 'waylamp') list.push({ item: 'hand_lantern', count: 1 });
  return list;
}
/** Stopgap unlock rule → { ok, hint } */
export function unlockState(r) {
  if (r.station === 'forge') return { ok: false, hint: 'Found deep below' };
  const u = r.unlock || 'default';
  if (u.startsWith('coziness:')) {
    const t = COZY_TIERS.find((c) => c.id === u.slice(9));
    if (!t || t.minScore <= 0) return { ok: true };
    return { ok: false, hint: `When your home feels like a ${t.name}` };
  }
  return { ok: true }; // default, g*_ goals and chapter: unlocks (chunk C wires the real ones)
}

export class CraftUI {
  /** opts: { getInv(), onCraft(recipe) → {ok, why?}, onPanel(open) } */
  constructor({ getInv, onCraft, onPanel }) {
    this.el = $('craftui'); this.tabsEl = $('craft-tabs'); this.list = $('craft-list'); this.title = $('craft-title');
    this.getInv = getInv; this.onCraft = onCraft; this.onPanel = onPanel;
    this.tab = 'tools'; this.station = 'hand'; this.isOpen = false;
    this.tabsEl.innerHTML = TABS.map(([id, name]) => `<button class="craft-tab" data-tab="${id}">${name}</button>`).join('');
    onTap(this.tabsEl, (id) => this.setTab(id), (el) => el.closest?.('[data-tab]')?.dataset.tab || null);
    onTap(this.list, (id) => this._craft(id), (el) => el.closest?.('.craft-go:not([disabled])')?.dataset.recipe || null);
    onTap(this.el.querySelector('.panel-close'), () => this.close());
  }
  open(station = 'hand', tab) {
    this.station = station; this.isOpen = true;
    if (tab) this.tab = tab;
    else if (station === 'cooking_pot') this.tab = 'food';
    else if (station === 'hand' && this.tab !== 'building' && this.tab !== 'light') this.tab = 'building';
    this.title.textContent = STATION_NAME[station] || 'Craft';
    this.el.classList.remove('hidden');
    this.render(); this.onPanel?.(true);
  }
  close() { if (!this.isOpen) return; this.isOpen = false; this.el.classList.add('hidden'); this.onPanel?.(false); }
  setTab(id) { this.tab = id; this.render(); }
  /** Where a recipe can be made right now → { ok, why } */
  stationState(r) {
    if (r.station === 'hand') return { ok: true };
    if (r.station === this.station) return { ok: true };
    if (r.station === 'bench') return { ok: false, why: 'Needs a crafting bench' };
    if (r.station === 'cooking_pot') return { ok: false, why: 'Needs a cooking pot by a lit fire' };
    return { ok: false, why: 'Needs a forge' };
  }
  recipes(tab = this.tab) { return RECIPES.filter((r) => r.category === tab); }
  render() {
    const inv = this.getInv();
    for (const b of this.tabsEl.children) b.classList.toggle('sel', b.dataset.tab === this.tab);
    const rows = this.recipes().map((r) => {
      const un = unlockState(r), st = this.stationState(r);
      const ing = ingredientsOf(r);
      const have = ing.every((i) => (inv[i.item] || 0) >= i.count);
      const can = un.ok && st.ok && have;
      const n = r.output.count > 1 ? ` ×${r.output.count}` : '';
      const owned = inv[outKey(r)] || 0;
      const ings = ing.map((i) => { const h = inv[i.item] || 0; return `<span class="ci ${h >= i.count ? 'ok' : 'no'}">${iconHtml(ITEM_INFO[i.item]?.img || ITEM_INFO[i.item]?.icon || i.item, 'sm')}${esc(itemLabel(i.item))} ${Math.min(h, 99)}/${i.count}</span>`; }).join('');
      const btn = !un.ok ? `<span class="craft-lock">${iconHtml('ui_lock', 'sm')} ${esc(un.hint)}</span>`
        : !st.ok ? `<span class="craft-lock">${esc(st.why)}</span>`
        : `<button class="craft-go" data-recipe="${r.id}" ${can ? '' : 'disabled'}>Craft</button>`;
      return `<div class="craft-card ${un.ok ? '' : 'locked'} ${can ? 'can' : ''}" data-id="${r.id}">
        <div class="craft-ico">${iconHtml(ICON[r.output.id] || PIECES[outKey(r)]?.icon || ITEM_INFO[r.output.id]?.img || r.output.id)}</div>
        <div class="craft-main"><div class="craft-name">${esc(r.name)}${n}${owned ? `<span class="craft-own">have ${owned}</span>` : ''}</div>
          <div class="craft-desc">${esc(r.description || '')}</div><div class="craft-ings">${ings}</div></div>
        <div class="craft-act">${btn}</div></div>`;
    }).join('');
    if (this._html !== rows) { this.list.innerHTML = rows; this._html = rows; }
  }
  _craft(id) {
    const r = RECIPES.find((x) => x.id === id); if (!r) return;
    const res = this.onCraft?.(r);
    this.render();
    if (res?.ok) {
      const card = this.list.querySelector(`[data-id="${id}"]`);
      card?.classList.remove('made'); void card?.offsetWidth; card?.classList.add('made');
    }
    return res;
  }
}
