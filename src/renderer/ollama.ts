import { CATEGORIES, type GemmaAnalysis } from './library';

export const OLLAMA_ENDPOINT = 'http://localhost:11434';
export const DEFAULT_MODEL = 'gemma3:4b';
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';
// Vision models can take several minutes when they are running on CPU. Keep the UI responsive,
// but do not fail a valid first-run request just because the model is still loading.
const TIMEOUT_MS = 300_000;

export interface OllamaConnection { ok: boolean; models: string[]; message: string; }

function timeoutSignal() { return AbortSignal.timeout(TIMEOUT_MS); }

export async function checkOllama(): Promise<OllamaConnection> {
  try {
    const response = await fetch(`${OLLAMA_ENDPOINT}/api/tags`, { signal: timeoutSignal() });
    if (!response.ok) return { ok: false, models: [], message: `Ollama returned ${response.status}.` };
    const payload = await response.json() as { models?: Array<{ name?: string }> };
    const models = (payload.models || []).map((model) => model.name).filter((name): name is string => Boolean(name));
    return { ok: true, models, message: `Connected to local Ollama (${models.length} model${models.length === 1 ? '' : 's'} found).` };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError' || error instanceof Error && /timed out|timeout/i.test(error.message);
    const message = timedOut ? 'Ollama did not respond within five minutes.' : 'Could not reach local Ollama. Start Ollama, then confirm its browser CORS origin allows this local app.';
    return { ok: false, models: [], message };
  }
}

const prompt = `Analyze this screenshot carefully. Return JSON only, with exactly these fields:
category (one of: code, internship poster, educational notes, webpage, email, document, diagram, other),
description (a concise visual description), topics (array), keywords (array), visible_text (array), dates (array), organizations (array), uncertainties (array).
Only include dates, organizations, and text that are visibly supported by the screenshot. Never infer or invent them. Use empty arrays when unavailable.`;

function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean).slice(0, 30) : []; }

export function validateAnalysis(value: unknown): GemmaAnalysis {
  if (!value || typeof value !== 'object') throw new Error('Gemma did not return a JSON object.');
  const raw = value as Record<string, unknown>;
  const category = typeof raw.category === 'string' && (CATEGORIES as readonly string[]).includes(raw.category) ? raw.category as GemmaAnalysis['category'] : 'other';
  return { category, description: typeof raw.description === 'string' ? raw.description.trim().slice(0, 900) : '', topics: stringArray(raw.topics), keywords: stringArray(raw.keywords), visible_text: stringArray(raw.visible_text), dates: stringArray(raw.dates), organizations: stringArray(raw.organizations), uncertainties: stringArray(raw.uncertainties) };
}

function parseModelJson(content: string) {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || content;
  try { return JSON.parse(fenced.trim()); } catch { throw new Error('Gemma returned malformed JSON. Retry the analysis.'); }
}

export async function analyzeImage(model: string, imageDataUrl: string): Promise<GemmaAnalysis> {
  const comma = imageDataUrl.indexOf(',');
  if (comma === -1) throw new Error('The image could not be prepared for analysis.');
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_ENDPOINT}/api/chat`, { method: 'POST', signal: timeoutSignal(), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, stream: false, format: 'json', messages: [{ role: 'user', content: prompt, images: [imageDataUrl.slice(comma + 1)] }] }) });
  } catch (error) {
    if (error instanceof Error && /timed out|timeout/i.test(error.message)) throw new Error('Gemma timed out after five minutes. Retry with a smaller screenshot or check local Ollama resources.');
    throw new Error('Could not contact local Ollama. It may be stopped or blocked by CORS for this browser origin.');
  }
  if (!response.ok) {
    if (response.status === 404) throw new Error(`The selected model “${model}” is not installed in Ollama.`);
    throw new Error(`Ollama analysis failed (${response.status}).`);
  }
  const payload = await response.json() as { message?: { content?: string } };
  if (!payload.message?.content) throw new Error('Ollama returned no analysis content.');
  return validateAnalysis(parseModelJson(payload.message.content));
}

function validEmbedding(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 8 || !value.every((item) => typeof item === 'number' && Number.isFinite(item))) throw new Error('Ollama returned an invalid embedding vector.');
  return value;
}

export async function embedText(model: string, input: string): Promise<number[]> {
  if (!input.trim()) throw new Error('There is no OCR or metadata text available to embed.');
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_ENDPOINT}/api/embed`, { method: 'POST', signal: timeoutSignal(), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }) });
  } catch (error) {
    if (error instanceof Error && /timed out|timeout/i.test(error.message)) throw new Error('Embedding timed out. Check local Ollama resources and retry.');
    throw new Error('Could not contact local Ollama. It may be stopped or blocked by CORS for this browser origin.');
  }
  if (!response.ok) {
    if (response.status === 404) throw new Error(`The embedding model “${model}” is not installed in Ollama.`);
    throw new Error(`Ollama embedding failed (${response.status}).`);
  }
  const payload = await response.json() as { embeddings?: unknown[] };
  return validEmbedding(payload.embeddings?.[0]);
}
