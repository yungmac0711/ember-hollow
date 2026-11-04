// LLM adapter interface. Swap providers via CONFIG.llm.provider (see llm/index.js).
//
// request = {
//   system:  string   — Wren's system prompt (story/companion_system_prompt.md)
//   context: string   — the filled [CONTEXT]…[/CONTEXT] block for this turn
//   history: [{role: 'user'|'assistant', content: string}]  — last N turns verbatim
//   message: string   — what Cam just typed
//   state:   object   — raw game state (lets offline adapters react without parsing text)
// }
// reply() resolves to Wren's reply text (already trimmed to the 35-word cap by the caller).
//
// summarize({ transcript, memory, instruction }) resolves to { summary: string, facts: [{type, text, weight}] }.
export class LLMAdapter {
  get id() { return 'base'; }
  /** @returns {Promise<string>} */
  async reply(_request) { throw new Error('reply() not implemented'); }
  /** @returns {Promise<{summary: string, facts: Array}>} */
  async summarize(_request) { return { summary: '', facts: [] }; }
}
