// Mobile-friendly chat panel. Keeps the input visible above the iOS/Android soft keyboard with the
// visualViewport API (the canvas is never resized while typing — see main.js resize guard).
import { CONFIG } from '../config.js';
import { SYSTEM_PROMPT } from './story-data.js';
import { buildContextBlock } from './context.js';

const WORD_CAP = 35;
export function capWords(text, n = WORD_CAP) {
  const words = text.trim().split(/\s+/);
  if (words.length <= n) return text.trim();
  let out = words.slice(0, n).join(' ');
  const lastStop = Math.max(out.lastIndexOf('.'), out.lastIndexOf('!'), out.lastIndexOf('?'));
  return lastStop > out.length * 0.5 ? out.slice(0, lastStop + 1) : out + '…';
}

export class ChatUI {
  constructor({ adapter, memory, getState, onOpen, onClose }) {
    this.adapter = adapter; this.memory = memory; this.getState = getState;
    this.onOpen = onOpen; this.onClose = onClose;
    this.el = document.getElementById('chat');
    this.log = document.getElementById('chat-log');
    this.form = document.getElementById('chat-form');
    this.input = document.getElementById('chat-input');
    this.el.querySelector('.chat-name').textContent = CONFIG.companion.name;
    this.open = false; this.busy = false;
    document.getElementById('chat-close').addEventListener('click', () => this.hide());
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.hide(); e.stopPropagation(); });
    // keep pointer events inside the panel from steering the camera
    for (const ev of ['pointerdown', 'pointermove', 'pointerup']) this.el.addEventListener(ev, (e) => e.stopPropagation());

    const vv = window.visualViewport;
    if (vv) {
      const fit = () => {
        if (!this.open) return;
        // Pin the panel to the visible area (above the keyboard).
        const top = vv.offsetTop + 6;
        const h = Math.max(140, Math.min(vv.height - 12, 420));
        this.el.style.top = `${top}px`;
        this.el.style.height = `${h}px`;
        this.log.scrollTop = this.log.scrollHeight;
      };
      vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit);
      this._fit = fit;
    }
    // iOS may still scroll the layout viewport when focusing; snap it back.
    this.input.addEventListener('focus', () => setTimeout(() => { window.scrollTo(0, 0); this._fit?.(); }, 50));
    this.input.addEventListener('blur', () => window.scrollTo(0, 0));

    // replay recent history so the panel isn't empty after a reload
    for (const t of memory.history()) this._bubble(t.role === 'user' ? 'me' : 'her', t.content);
  }

  show() {
    if (this.open) return;
    this.open = true;
    this.el.classList.remove('hidden');
    this.el.style.top = ''; this.el.style.height = '';
    if (!this.log.children.length) {
      const hello = this.memory.isFirstMeeting
        ? "Oh — a light. Thank the stone. I'm Wren. You look as lost as I feel."
        : `You came back, ${CONFIG.playerName}. Fire nearly forgot you — I didn't.`;
      this._bubble('her', hello);
      this.memory.addMessage('assistant', hello);
    }
    this.onOpen?.();
    // Don't auto-focus on touch devices (it would pop the keyboard over the view immediately).
    if (!matchMedia('(pointer: coarse)').matches) this.input.focus();
    this._fit?.();
  }

  hide() {
    if (!this.open) return;
    this.open = false;
    this.input.blur();
    this.el.classList.add('hidden');
    window.scrollTo(0, 0);
    this.onClose?.();
  }

  toggle() { this.open ? this.hide() : this.show(); }

  _bubble(who, text, cls = '') {
    const d = document.createElement('div');
    d.className = `msg ${who} ${cls}`; d.textContent = text;
    this.log.appendChild(d); this.log.scrollTop = this.log.scrollHeight;
    return d;
  }

  /** Ambient lines also land in the log so the conversation reads naturally. */
  addAmbient(line) { this._bubble('her', line); }

  async send() {
    const text = this.input.value.trim();
    if (!text || this.busy) return;
    this.input.value = '';
    this._bubble('me', text);
    const history = this.memory.history();
    this.memory.addMessage('user', text);
    this.busy = true;
    const typing = this._bubble('her', `${CONFIG.companion.name} is thinking…`, 'typing');
    try {
      const state = this.getState();
      const reply = capWords(await this.adapter.reply({
        system: SYSTEM_PROMPT, context: buildContextBlock(state), history, message: text, state }));
      typing.remove();
      this._bubble('her', reply);
      this.memory.addMessage('assistant', reply);
    } catch (e) {
      console.warn('[chat] reply failed', e);
      typing.textContent = '(Wren is quiet for a moment… try again.)';
      typing.classList.remove('typing');
    } finally { this.busy = false; }
  }
}
