// OpenAI-compatible chat-completions adapter — NOT active by default (CONFIG.llm.provider = 'stub').
// Point CONFIG.llm.http.endpoint at YOUR OWN small proxy (e.g. a Cloudflare Worker) that adds the
// API key server-side. Never ship an API key in this client code.
import { LLMAdapter } from './adapter.js';

export class HttpAdapter extends LLMAdapter {
  constructor(cfg) { super(); this.cfg = cfg; }
  get id() { return 'http'; }

  async _chat(messages, maxTokens) {
    if (!this.cfg.endpoint) throw new Error('CONFIG.llm.http.endpoint is not set');
    const res = await fetch(this.cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.cfg.model, temperature: this.cfg.temperature, max_tokens: maxTokens, messages }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  async reply({ system, context, history, message }) {
    return this._chat([
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: `${context}\nPlayer: ${message}` },
    ], this.cfg.maxTokens);
  }

  async summarize({ transcript, memory, instruction }) {
    const text = await this._chat([
      { role: 'system', content: instruction },
      { role: 'user', content: JSON.stringify({ memory, transcript }) },
    ], 300);
    try {
      const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      return { summary: String(j.summary || '').slice(0, 200), facts: Array.isArray(j.facts) ? j.facts.slice(0, 3) : [] };
    } catch { return { summary: text.slice(0, 200), facts: [] }; }
  }
}
