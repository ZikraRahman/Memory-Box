import { describe, expect, it } from 'vitest';
import { DEFAULT_EMBEDDING_MODEL } from './ollama';
import { validateAnalysis } from './ollama';

describe('Gemma analysis validation', () => {
  it('normalizes unsupported categories and missing arrays safely', () => {
    expect(validateAnalysis({ category: 'guessed', description: ' A screenshot ', topics: ['python', 4], dates: 'tomorrow' })).toEqual({
      category: 'other', description: 'A screenshot', topics: ['python'], keywords: [], visible_text: [], dates: [], organizations: [], uncertainties: [],
    });
  });
  it('rejects malformed non-object results', () => expect(() => validateAnalysis('not json')).toThrow('JSON object'));
  it('uses a dedicated local embedding model instead of the vision model', () => expect(DEFAULT_EMBEDDING_MODEL).toBe('nomic-embed-text'));
});
