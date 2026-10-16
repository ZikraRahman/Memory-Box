import { createWorker } from 'tesseract.js';

export const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const DATABASE = 'memorybox-demo';
const STORE = 'screenshots';

export const CATEGORIES = ['code', 'internship poster', 'educational notes', 'webpage', 'email', 'document', 'diagram', 'other'] as const;
export type ScreenshotCategory = (typeof CATEGORIES)[number];
export type AnalysisStatus = 'not-analyzed' | 'processing' | 'succeeded' | 'failed';
export type EmbeddingStatus = 'not-embedded' | 'embedding' | 'embedded' | 'failed';

export interface GemmaAnalysis {
  category: ScreenshotCategory;
  description: string;
  topics: string[];
  keywords: string[];
  visible_text: string[];
  dates: string[];
  organizations: string[];
  uncertainties: string[];
}

export interface ScreenshotRecord {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  addedAt: string;
  text: string;
  thumbnail: string;
  width: number;
  height: number;
  analysisStatus?: AnalysisStatus;
  analysis?: GemmaAnalysis;
  analysisError?: string;
  analysisUpdatedAt?: string;
  embedding?: number[];
  embeddingModel?: string;
  embeddingStatus?: EmbeddingStatus;
  embeddingError?: string;
  embeddingUpdatedAt?: string;
}

export interface IndexProgress { processed: number; total: number; failures: number; current?: string; }

export function fileId(file: File) { return `${file.name}:${file.size}:${file.lastModified}`; }
export function isSupportedImage(file: File) { return IMAGE_TYPES.has(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name); }
export function statusOf(record: ScreenshotRecord): AnalysisStatus { return record.analysisStatus || (record.analysis ? 'succeeded' : 'not-analyzed'); }
export function embeddingStatusOf(record: ScreenshotRecord): EmbeddingStatus { return record.embeddingStatus || (record.embedding?.length ? 'embedded' : 'not-embedded'); }

const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'at', 'for', 'from', 'in', 'is', 'of', 'on', 'or', 'the', 'to', 'with']);
export function queryTerms(query: string) {
  return query.toLowerCase().trim().split(/\s+/).map((term) => term.replace(/[^\p{L}\p{N}+-]/gu, '')).filter((term) => term && !STOP_WORDS.has(term));
}

function metadataText(record: ScreenshotRecord) {
  const analysis = record.analysis;
  if (!analysis) return '';
  return [analysis.category, analysis.description, ...analysis.topics, ...analysis.keywords, ...analysis.visible_text, ...analysis.dates, ...analysis.organizations].join(' ').toLowerCase();
}

export function embeddingText(record: ScreenshotRecord) {
  const analysis = record.analysis;
  return [
    `Screenshot filename: ${record.filename}`,
    `OCR text: ${record.text || 'No readable OCR text.'}`,
    analysis && `Category: ${analysis.category}`,
    analysis && `Description: ${analysis.description}`,
    analysis?.topics.length && `Topics: ${analysis.topics.join(', ')}`,
    analysis?.keywords.length && `Keywords: ${analysis.keywords.join(', ')}`,
    analysis?.visible_text.length && `Visible text: ${analysis.visible_text.join(', ')}`,
    analysis?.dates.length && `Visible dates: ${analysis.dates.join(', ')}`,
    analysis?.organizations.length && `Organizations: ${analysis.organizations.join(', ')}`,
  ].filter(Boolean).join('\n').slice(0, 12_000);
}

export function matchSources(record: ScreenshotRecord, query: string) {
  const terms = queryTerms(query);
  const ocr = record.text.toLowerCase();
  const metadata = metadataText(record);
  return { ocr: terms.some((term) => ocr.includes(term)), metadata: terms.some((term) => metadata.includes(term)) };
}

export function searchRecords(records: ScreenshotRecord[], query: string) {
  const terms = queryTerms(query);
  if (!terms.length) return records;
  return records.map((record) => {
    const ocr = record.text.toLowerCase();
    const metadata = metadataText(record);
    const category = record.analysis?.category.toLowerCase() || '';
    const score = terms.reduce((total, term) => total + (ocr.includes(term) ? 4 : 0) + (metadata.includes(term) ? 2 : 0) + (category.includes(term) ? 3 : 0), 0);
    return { record, score };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || b.record.addedAt.localeCompare(a.record.addedAt)).map(({ record }) => record);
}

export interface RankedRecord { record: ScreenshotRecord; score: number; keywordScore: number; semanticScore?: number; }

export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0, leftMagnitude = 0, rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

export function rankRecords(records: ScreenshotRecord[], query: string, queryEmbedding?: number[]): RankedRecord[] {
  const terms = queryTerms(query);
  if (!query.trim()) return records.map((record) => ({ record, score: 0, keywordScore: 0 }));
  return records.map((record) => {
    const ocr = record.text.toLowerCase();
    const metadata = metadataText(record);
    const category = record.analysis?.category.toLowerCase() || '';
    const keywordScore = terms.reduce((total, term) => total + (ocr.includes(term) ? 4 : 0) + (metadata.includes(term) ? 2 : 0) + (category.includes(term) ? 3 : 0), 0);
    const semanticScore = queryEmbedding && record.embedding && record.embeddingModel ? cosineSimilarity(queryEmbedding, record.embedding) : undefined;
    // Keyword evidence wins when present; otherwise use a conservative cosine cutoff.
    const score = keywordScore + (semanticScore === undefined ? 0 : Math.max(0, semanticScore) * 5);
    return { record, score, keywordScore, semanticScore };
  }).filter((result) => result.keywordScore > 0 || result.semanticScore !== undefined && result.semanticScore >= 0.18)
    .sort((a, b) => b.score - a.score || b.record.addedAt.localeCompare(a.record.addedAt));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getRecords(): Promise<ScreenshotRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => { db.close(); resolve((request.result as ScreenshotRecord[]).sort((a, b) => b.addedAt.localeCompare(a.addedAt))); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function saveRecord(record: ScreenshotRecord) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(record);
    request.onsuccess = () => { db.close(); resolve(); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function clearRecords() {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
    request.onsuccess = () => { db.close(); resolve(); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function canvasImage(file: File, maxEdge: number, quality: number) {
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width, height = bitmap.height;
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { width, height, data: canvas.toDataURL('image/jpeg', quality) };
}

async function imageInfo(file: File) {
  const thumbnail = await canvasImage(file, 560, 0.76);
  const source = await createImageBitmap(file);
  const width = source.width, height = source.height;
  source.close();
  return { width, height, thumbnail: thumbnail.data };
}

export async function imageForAnalysis(file: File) {
  // This payload only exists in memory for the local Ollama request; it is never stored in IndexedDB.
  return (await canvasImage(file, 1280, 0.86)).data;
}

export async function indexFiles(files: File[], knownIds: Set<string>, progress: (value: IndexProgress) => void) {
  const accepted = files.filter(isSupportedImage);
  let processed = 0, failures = files.length - accepted.length;
  const worker = accepted.length ? await createWorker('eng') : undefined;
  const records: ScreenshotRecord[] = [];
  try {
    for (const file of accepted) {
      progress({ processed, total: files.length, failures, current: file.name });
      if (knownIds.has(fileId(file))) { processed++; progress({ processed, total: files.length, failures, current: file.name }); continue; }
      try {
        const info = await imageInfo(file);
        const result = await worker!.recognize(file);
        const record: ScreenshotRecord = { id: fileId(file), filename: file.name, mimeType: file.type, size: file.size, addedAt: new Date().toISOString(), text: result.data.text.trim(), thumbnail: info.thumbnail, width: info.width, height: info.height, analysisStatus: 'not-analyzed' };
        await saveRecord(record); records.push(record); knownIds.add(record.id);
      } catch { failures++; }
      processed++; progress({ processed, total: files.length, failures, current: file.name });
    }
  } finally { await worker?.terminate(); }
  return { records, failures, unsupported: files.length - accepted.length };
}
