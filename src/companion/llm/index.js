import { StubAdapter } from './stub-adapter.js';
import { HttpAdapter } from './http-adapter.js';

/** Factory: add new providers here. */
export function createAdapter(llmConfig) {
  switch (llmConfig.provider) {
    case 'http':
      if (llmConfig.http.endpoint) return new HttpAdapter(llmConfig.http);
      console.warn('[llm] http provider selected but no endpoint configured; using stub');
      return new StubAdapter();
    case 'stub':
    default:
      return new StubAdapter();
  }
}
