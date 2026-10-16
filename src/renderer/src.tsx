import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { clearRecords, embeddingStatusOf, embeddingText, fileId, getRecords, imageForAnalysis, indexFiles, matchSources, rankRecords, saveRecord, statusOf, type IndexProgress, type ScreenshotRecord } from './library';
import { analyzeImage, checkOllama, DEFAULT_EMBEDDING_MODEL, DEFAULT_MODEL, embedText, OLLAMA_ENDPOINT, type OllamaConnection } from './ollama';
import './style.css';

const suggestions = ['Python installation error', 'Internship deadline', 'train-test split', 'meeting link'];
const saved = <T,>(key: string, fallback: T): T => { try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value) as T; } catch { return fallback; } };

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return <>{text.split(pattern).map((part, index) => terms.some((term) => part.toLowerCase() === term.toLowerCase()) ? <mark key={index}>{part}</mark> : part)}</>;
}

function Chips({ label, items }: { label: string; items: string[] }) { return items.length ? <div className="metadata"><b>{label}</b><div>{items.map((item) => <span key={item}>{item}</span>)}</div></div> : null; }

function App() {
  const [records, setRecords] = useState<ScreenshotRecord[]>([]);
  const [query, setQuery] = useState('');
  const [queryEmbedding, setQueryEmbedding] = useState<number[]>();
  const [queryStatus, setQueryStatus] = useState('');
  const [progress, setProgress] = useState<IndexProgress>();
  const [analysisProgress, setAnalysisProgress] = useState<IndexProgress>();
  const [embeddingProgress, setEmbeddingProgress] = useState<IndexProgress>();
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<ScreenshotRecord>();
  const [dragging, setDragging] = useState(false);
  const [model, setModel] = useState(() => saved('memorybox-model', DEFAULT_MODEL));
  const [embeddingModel, setEmbeddingModel] = useState(() => saved('memorybox-embedding-model', DEFAULT_EMBEDDING_MODEL));
  const [autoAnalyze, setAutoAnalyze] = useState(() => saved('memorybox-auto-analyze', false));
  const [connection, setConnection] = useState<OllamaConnection>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const isIndexing = Boolean(progress && progress.processed < progress.total);
  const isAnalyzing = Boolean(analysisProgress && analysisProgress.processed < analysisProgress.total);
  const isEmbedding = Boolean(embeddingProgress && embeddingProgress.processed < embeddingProgress.total);

  useEffect(() => {
    void getRecords().then(async (stored) => {
      const recovered = await Promise.all(stored.map(async (record) => {
        if (statusOf(record) !== 'processing' && embeddingStatusOf(record) !== 'embedding') return record;
        const interrupted = { ...record, ...(statusOf(record) === 'processing' ? { analysisStatus: 'failed' as const, analysisError: 'Gemma analysis was interrupted. Retry when Ollama is ready.' } : {}), ...(embeddingStatusOf(record) === 'embedding' ? { embeddingStatus: 'failed' as const, embeddingError: 'Embedding was interrupted. Retry when Ollama is ready.' } : {}) };
        await saveRecord(interrupted); return interrupted;
      }));
      setRecords(recovered);
    }).catch(() => setNotice('Your browser blocked IndexedDB. Try a current desktop browser.'));
  }, []);
  useEffect(() => { void testConnection(); }, []);
  useEffect(() => { localStorage.setItem('memorybox-model', JSON.stringify(model)); }, [model]);
  useEffect(() => { localStorage.setItem('memorybox-embedding-model', JSON.stringify(embeddingModel)); }, [embeddingModel]);
  useEffect(() => { localStorage.setItem('memorybox-auto-analyze', JSON.stringify(autoAnalyze)); }, [autoAnalyze]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('#search')?.focus(); } if (event.key === 'Escape') setDetail(undefined); }; addEventListener('keydown', onKey); return () => removeEventListener('keydown', onKey); }, []);

  const updateRecord = async (record: ScreenshotRecord) => { await saveRecord(record); setRecords((current) => current.map((entry) => entry.id === record.id ? record : entry)); setDetail((current) => current?.id === record.id ? record : current); };
  const testConnection = async () => { const result = await checkOllama(); setConnection(result); return result; };
  const available = (name: string, local = connection) => Boolean(local?.ok && local.models.includes(name));

  const embedOne = async (record: ScreenshotRecord, force = false) => {
    if (!force && embeddingStatusOf(record) === 'embedded' && record.embeddingModel === embeddingModel) return { skipped: true, failed: false };
    const processing = { ...record, embeddingStatus: 'embedding' as const, embeddingError: undefined }; await updateRecord(processing);
    try {
      const embedding = await embedText(embeddingModel, embeddingText(processing));
      await updateRecord({ ...processing, embedding, embeddingModel, embeddingStatus: 'embedded', embeddingUpdatedAt: new Date().toISOString() });
      return { skipped: false, failed: false };
    } catch (error) { const message = error instanceof Error ? error.message : 'Embedding failed.'; await updateRecord({ ...processing, embeddingStatus: 'failed', embeddingError: message }); return { skipped: false, failed: true }; }
  };

  const embedMany = async (targets: ScreenshotRecord[], force = false) => {
    const pending = targets.filter((record) => force || embeddingStatusOf(record) !== 'embedded' || record.embeddingModel !== embeddingModel);
    if (!pending.length) { setNotice('Every screenshot already has an embedding for the selected model.'); return; }
    const local = await testConnection();
    if (!local.ok) { setNotice(local.message); return; }
    if (!local.models.includes(embeddingModel)) { setNotice(`Semantic search is ready when you install “${embeddingModel}”. OCR and keyword search remain available.`); return; }
    let processed = 0, failures = 0; setEmbeddingProgress({ processed, total: pending.length, failures, current: pending[0]?.filename });
    for (const record of pending) { const result = await embedOne(record, force); if (result.failed) failures++; processed++; setEmbeddingProgress({ processed, total: pending.length, failures, current: record.filename }); }
    setEmbeddingProgress(undefined); setNotice(`${processed - failures} local embeddings saved${failures ? ` · ${failures} failed (use Retry)` : ''}`);
  };

  const analyzeOne = async (record: ScreenshotRecord, source?: File, force = false) => {
    if (!force && statusOf(record) === 'succeeded') return { skipped: true, failed: false };
    const processing = { ...record, analysisStatus: 'processing' as const, analysisError: undefined }; await updateRecord(processing);
    try {
      const analysis = await analyzeImage(model, source ? await imageForAnalysis(source) : record.thumbnail);
      const completed = { ...processing, analysis, analysisStatus: 'succeeded' as const, analysisUpdatedAt: new Date().toISOString() };
      await updateRecord(completed); if (available(embeddingModel)) await embedOne(completed, true);
      return { skipped: false, failed: false };
    } catch (error) { const message = error instanceof Error ? error.message : 'Gemma analysis failed.'; await updateRecord({ ...processing, analysisStatus: 'failed', analysisError: message }); return { skipped: false, failed: true }; }
  };

  const analyzeMany = async (targets: ScreenshotRecord[], files = new Map<string, File>(), force = false) => {
    const pending = targets.filter((record) => force || statusOf(record) !== 'succeeded');
    if (!pending.length) { setNotice('Every selected screenshot already has a valid Gemma result.'); return; }
    const local = await testConnection();
    if (!local.ok) { setNotice(local.message); return; }
    if (!local.models.includes(model)) { setNotice(`The selected model “${model}” is not installed in local Ollama.`); return; }
    let processed = 0, failures = 0; setAnalysisProgress({ processed, total: pending.length, failures, current: pending[0]?.filename });
    for (const record of pending) { const result = await analyzeOne(record, files.get(record.id), force); if (result.failed) failures++; processed++; setAnalysisProgress({ processed, total: pending.length, failures, current: record.filename }); }
    setAnalysisProgress(undefined); setNotice(`${processed - failures} analyzed with Gemma${failures ? ` · ${failures} failed (use Retry)` : ''}`);
  };

  const upload = async (files: File[]) => {
    if (!files.length || isIndexing || isAnalyzing || isEmbedding) return;
    setNotice(''); setProgress({ processed: 0, total: files.length, failures: 0 });
    try {
      const result = await indexFiles(files, new Set(records.map((record) => record.id)), setProgress);
      const latest = await getRecords(); setRecords(latest); setNotice(`${result.records.length} indexed${result.failures ? ` · ${result.failures} skipped` : ''}${result.unsupported ? ` · ${result.unsupported} unsupported` : ''}`);
      if (result.records.length) await embedMany(result.records);
      if (autoAnalyze && result.records.length) await analyzeMany(result.records, new Map(files.map((file) => [fileId(file), file])));
    } catch { setNotice('Indexing could not start. Check that this browser supports Web Workers and IndexedDB.'); } finally { setProgress(undefined); }
  };

  useEffect(() => {
    if (!query.trim()) { setQueryEmbedding(undefined); setQueryStatus(''); return; }
    if (!available(embeddingModel)) { setQueryEmbedding(undefined); setQueryStatus(`Semantic search unavailable — install ${embeddingModel} to enable it.`); return; }
    let live = true; const timer = window.setTimeout(() => { void embedText(embeddingModel, query).then((vector) => { if (live) { setQueryEmbedding(vector); setQueryStatus('Semantic ranking active'); } }).catch((error) => { if (live) { setQueryEmbedding(undefined); setQueryStatus(error instanceof Error ? error.message : 'Semantic search unavailable.'); } }); }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [query, embeddingModel, connection?.ok, connection?.models.join('|')]);

  const clear = async () => { if (!confirm('Remove all saved OCR text, local-AI metadata, embeddings, and thumbnails from this browser? Original screenshots are not stored.')) return; await clearRecords(); setRecords([]); setDetail(undefined); setNotice('Local library cleared.'); };
  const ranked = rankRecords(records, query, queryEmbedding);
  const modelChoices = Array.from(new Set([model, DEFAULT_MODEL, ...(connection?.models || [])]));
  const embeddingChoices = Array.from(new Set([embeddingModel, DEFAULT_EMBEDDING_MODEL, ...(connection?.models || [])]));
  const embeddedCount = records.filter((record) => embeddingStatusOf(record) === 'embedded' && record.embeddingModel === embeddingModel).length;

  return <div className="app"><aside><div className="brand"><span className="mark">M</span>MemoryBox <small>DEMO</small></div><nav><button className="active">⌕ <span>Search</span></button><button>▣ <span>{records.length} indexed</span></button><button onClick={() => setSettingsOpen((open) => !open)}>⚙ <span>Local AI</span></button></nav><div className="privacy"><b>Local-only processing</b><p>OCR runs in your browser. Gemma and embeddings use only your Ollama at localhost.</p></div></aside><main><header><div><p className="eyebrow">PRIVATE SCREENSHOT SEARCH</p><h1>Find what you saw.</h1><p className="sub">Keyword search always works. Optional local embeddings add meaning-based retrieval.</p></div><button className="clear" onClick={clear} disabled={!records.length}>Clear library</button></header>
    {settingsOpen && <section className="settings"><div><p className="eyebrow">LOCAL AI SETTINGS</p><h2>Gemma Vision + semantic search</h2><p>Uses only <code>{OLLAMA_ENDPOINT}</code>. Images stay on this device; text embeddings are computed locally and saved in IndexedDB.</p></div><label>Vision model<select value={model} onChange={(event) => setModel(event.target.value)}>{modelChoices.map((name) => <option key={name}>{name}</option>)}</select></label><label>Embedding model<select value={embeddingModel} onChange={(event) => setEmbeddingModel(event.target.value)}>{embeddingChoices.map((name) => <option key={name}>{name}</option>)}</select></label><label className="toggle"><input type="checkbox" checked={autoAnalyze} onChange={(event) => setAutoAnalyze(event.target.checked)}/><span>Analyze new uploads automatically</span></label><button className="secondary" onClick={() => void testConnection()}>Test connection</button><div className={`connection ${connection?.ok ? 'ok' : 'bad'}`}>{connection?.message || 'Checking local Ollama…'} {connection?.ok && !connection.models.includes(embeddingModel) && <b> Install <code>ollama pull {embeddingModel}</code> for semantic search.</b>}</div></section>}
    <section className="search"><span>⌕</span><input id="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by text or meaning…"/><kbd>⌘ K</kbd></section><section className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void upload(Array.from(event.dataTransfer.files)); }}><input ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={(event) => { void upload(Array.from(event.target.files || [])); event.currentTarget.value = ''; }}/><div className="dropicon">⇧</div><div><b>Drop screenshots here</b><p>PNG, JPG, JPEG, or WebP · select up to ~80 at once</p></div><button className="primary" onClick={() => fileInput.current?.click()} disabled={isIndexing || isAnalyzing || isEmbedding}>{isIndexing ? 'Indexing…' : 'Choose images'}</button></section><p className="privacyline">OCR runs in a browser worker. Gemma vision and semantic embeddings are optional, local Ollama requests. No backend or cloud API is used.</p>
    {progress && <section className="progress"><div><b>Indexing {progress.current || 'screenshots'}</b><span>{progress.processed} of {progress.total} processed · {progress.failures} failed</span></div><div className="bar"><i style={{ width: `${progress.total ? progress.processed / progress.total * 100 : 0}%` }}/></div></section>}{analysisProgress && <section className="progress gemma-progress"><div><b>Gemma analyzing {analysisProgress.current}</b><span>{analysisProgress.processed} of {analysisProgress.total} processed · {analysisProgress.failures} failed</span></div><div className="bar"><i style={{ width: `${analysisProgress.total ? analysisProgress.processed / analysisProgress.total * 100 : 0}%` }}/></div></section>}{embeddingProgress && <section className="progress embedding-progress"><div><b>Embedding {embeddingProgress.current}</b><span>{embeddingProgress.processed} of {embeddingProgress.total} processed · {embeddingProgress.failures} failed</span></div><div className="bar"><i style={{ width: `${embeddingProgress.total ? embeddingProgress.processed / embeddingProgress.total * 100 : 0}%` }}/></div></section>}
    {notice && <p className="notice">{notice}</p>}<div className="toolbar"><span>{query ? `${ranked.length} ranked results${queryStatus ? ` · ${queryStatus}` : ''}` : `${records.length} locally indexed · ${embeddedCount} semantic-ready`}</span><div>{records.some((record) => embeddingStatusOf(record) !== 'embedded' || record.embeddingModel !== embeddingModel) && <button className="secondary" disabled={isEmbedding} onClick={() => void embedMany(records)}>Embed pending</button>}{records.some((record) => statusOf(record) !== 'succeeded') && <button className="secondary" disabled={isAnalyzing} onClick={() => void analyzeMany(records)}>Analyze pending with Gemma</button>}{!records.length && <div className="suggestions">{suggestions.map((suggestion) => <button key={suggestion} onClick={() => setQuery(suggestion)}>{suggestion}</button>)}</div>}</div></div>
    {ranked.length ? <section className="results">{ranked.map(({ record, keywordScore, semanticScore }) => { const status = statusOf(record); const sources = matchSources(record, query); return <article key={record.id} onClick={() => setDetail(record)}><img src={record.thumbnail} alt={`Thumbnail of ${record.filename}`}/><div className="card"><div className="line"><b>{record.filename}</b><em className={`status ${status}`}>{status.replace('-', ' ')}</em></div>{record.analysis && <div className="card-meta"><span>{record.analysis.category}</span>{record.analysis.keywords.slice(0, 2).map((item) => <span key={item}>{item}</span>)}</div>}<p><Highlight text={record.analysis?.description || record.text.slice(0, 260) || 'No readable text found in this screenshot.'} query={query}/></p>{query && <small>{keywordScore > 0 && <>{sources.ocr && 'OCR match'}{sources.ocr && sources.metadata && ' · '}{sources.metadata && 'Gemma metadata match'}</>}{keywordScore > 0 && semanticScore !== undefined && ' · '}{semanticScore !== undefined && `Semantic ${Math.round(semanticScore * 100)}%`}</small>}<small>{record.width}×{record.height} · {new Date(record.addedAt).toLocaleDateString()}</small></div></article>; })}</section> : <section className="empty"><div className="orb">✦</div><h2>{query ? 'No matching screenshot context yet.' : 'Your private screenshot library starts here.'}</h2><p>{query ? 'Try different wording, or install the local embedding model and embed your library for meaning-based results.' : 'Drop a few screenshots above. MemoryBox saves OCR text, optional local-AI metadata, embeddings, and compact thumbnails in this browser.'}</p></section>}
    {detail && <div className="modal" onClick={() => setDetail(undefined)}><div className="dialog" onClick={(event) => event.stopPropagation()}><button className="close" onClick={() => setDetail(undefined)}>×</button><img src={detail.thumbnail} alt={`Preview of ${detail.filename}`}/><div><p className="eyebrow">{new Date(detail.addedAt).toLocaleString()}</p><h2>{detail.filename}</h2><p className="path">{detail.width}×{detail.height} · {(detail.size / 1024).toFixed(0)} KB original</p><div className="detail-actions"><span className={`status ${statusOf(detail)}`}>{statusOf(detail).replace('-', ' ')}</span><span className={`status ${embeddingStatusOf(detail)}`}>{embeddingStatusOf(detail).replace('-', ' ')}</span><button className="secondary" disabled={isAnalyzing || statusOf(detail) === 'processing'} onClick={() => void analyzeMany([detail], new Map(), statusOf(detail) === 'succeeded')}>{statusOf(detail) === 'failed' ? 'Retry Gemma' : statusOf(detail) === 'succeeded' ? 'Reanalyze' : 'Analyze with Gemma'}</button><button className="secondary" disabled={isEmbedding || embeddingStatusOf(detail) === 'embedding'} onClick={() => void embedMany([detail], embeddingStatusOf(detail) === 'embedded')}>{embeddingStatusOf(detail) === 'failed' ? 'Retry embedding' : embeddingStatusOf(detail) === 'embedded' ? 'Re-embed' : 'Create embedding'}</button></div><h3>OCR text <small>Browser Tesseract</small></h3><pre><Highlight text={detail.text || 'No readable text was extracted.'} query={query}/></pre>{detail.analysis && <><h3>Gemma description <small>Local AI metadata</small></h3><p className="description"><Highlight text={detail.analysis.description || 'No description returned.'} query={query}/></p><Chips label="Topics" items={detail.analysis.topics}/><Chips label="Keywords" items={detail.analysis.keywords}/><Chips label="Visible text (Gemma)" items={detail.analysis.visible_text}/><Chips label="Dates" items={detail.analysis.dates}/><Chips label="Organizations" items={detail.analysis.organizations}/><Chips label="Uncertainties" items={detail.analysis.uncertainties}/></>}{detail.analysisError && <p className="error">Gemma: {detail.analysisError}</p>}{detail.embeddingError && <p className="error">Embedding: {detail.embeddingError}</p>}<p className="detailnote">Embeddings are local vectors derived from saved OCR and metadata. They are reused for search and regenerated only after relevant content changes.</p></div></div></div>}</main></div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
