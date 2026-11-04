import { StubAdapter } from './stub-adapter.js';
import { HttpAdapter } from './http-adapter.js';
import { BankAdapter } from './bank-adapter.js';

/** Factory: add new providers here. */
export function createAdapter(llmConfig) {
  switch (llmConfig.provider) {
    case 'http':
      if (llmConfig.http.endpoint) return new HttpAdapter(llmConfig.http);
      console.warn('[llm] http provider selected but no endpoint configured; using the reply bank');
      return new BankAdapter();
    case 'stub': // M0 keyword stub, kept for comparison (?llm=stub)
      return new StubAdapter();
    case 'bank': // offline reply bank from story/data/wren_replies.json (default)
    default:
      return new BankAdapter();
  }
}
