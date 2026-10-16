import { describe, expect, it } from 'vitest';
import { cosineSimilarity, embeddingText, fileId, rankRecords, searchRecords, statusOf, type ScreenshotRecord } from './library';
const record = (text: string): ScreenshotRecord => ({ id: text, filename: 'screen.png', mimeType: 'image/png', size: 1, addedAt: '2026-10-16T00:00:00.000Z', text, thumbnail: '', width: 1, height: 1 });
describe('local OCR search', () => {
  it('matches every query word against extracted text', () => expect(searchRecords([record('Python installation error from pip'), record('October internship notice')], 'python error')).toHaveLength(1));
  it('does not search only file names', () => expect(searchRecords([record('train-test split notes')], 'train test')).toHaveLength(1));
  it('searches and ranks local Gemma metadata separately from OCR', () => {
    const ai = { ...record(''), analysis: { category: 'internship poster' as const, description: 'A local event announcement', topics: ['Hacktoberfest'], keywords: ['application deadline'], visible_text: [], dates: ['October 2026'], organizations: [], uncertainties: [] } };
    expect(searchRecords([record('plain note'), ai], 'Hacktoberfest October')).toEqual([ai]);
  });
  it('keeps older records without analysis in OCR-only mode', () => expect(statusOf(record('ocr only'))).toBe('not-analyzed'));
  it('ranks a semantic match even when query and OCR words do not overlap', () => {
    const internPoster = { ...record('INTERNS NEEDED'), analysis: { category: 'internship poster' as const, description: 'Recruitment announcement', topics: [], keywords: [], visible_text: [], dates: [], organizations: [], uncertainties: [] }, embedding: [1, 0], embeddingModel: 'nomic-embed-text' };
    const unrelated = { ...record('Python stack trace'), embedding: [0, 1], embeddingModel: 'nomic-embed-text' };
    expect(rankRecords([unrelated, internPoster], 'internship opportunity', [0.98, 0.02]).map(({ record: match }) => match)).toEqual([internPoster]);
  });
  it('builds an embedding document from OCR and saved Gemma metadata', () => {
    const screenshot = { ...record('INTERNS NEEDED'), analysis: { category: 'internship poster' as const, description: 'Recruitment announcement', topics: ['careers'], keywords: ['opportunity'], visible_text: [], dates: [], organizations: [], uncertainties: [] } };
    expect(embeddingText(screenshot)).toContain('Category: internship poster');
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
  });
  it('builds a stable duplicate id from file metadata', () => expect(fileId({ name: 'a.png', size: 12, lastModified: 9 } as File)).toBe('a.png:12:9'));
});
