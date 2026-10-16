# MemoryBox web demo

MemoryBox is a privacy-first screenshot search demo. Drop screenshots into the browser, let local Tesseract.js OCR read their text, then search that extracted text. Optionally, use a locally running Ollama vision model to create extra screenshot metadata. There is no application backend, account system, analytics, upload endpoint, cloud OCR, or cloud AI API.

## Run locally

Use Node.js 20 or newer:

```powershell
npm install
npm run dev
```

Open the local Vite address shown in the terminal (normally `http://localhost:5173`). For a production build:

```powershell
npm run typecheck
npm test
npm run build
npm run preview
```

## Demo workflow

1. Drag PNG, JPG/JPEG, or WebP screenshots onto the upload panel, or use **Choose images**.
2. Approve the browser’s first-time OCR language-data download if prompted by Tesseract.js.
3. Watch per-image indexing progress and failures.
4. Optionally open **Local AI** and use **Test connection**. MemoryBox defaults to `gemma3:4b` at `http://localhost:11434`.
5. Enable automatic analysis for new uploads, analyze pending screenshots in a batch, or open an image and choose **Analyze with Gemma**. Existing valid analyses are skipped unless you explicitly reanalyze.
6. Install the local embedding model once, then choose **Embed pending**. MemoryBox creates and stores a vector from each screenshot's OCR and saved Gemma metadata; it does not run Gemma again for search.
7. Search by words or meaning. With embeddings ready, queries such as `internship opportunity` can retrieve an `INTERNS NEEDED` poster even without identical words. Result cards label keyword/OCR evidence separately from semantic similarity.
7. Select a result to view its thumbnail preview, raw OCR text, and the separate local Gemma description and metadata.

## Local Ollama setup

Install and start Ollama, then ensure the selected vision model is present:

```powershell
ollama pull gemma3:4b
ollama pull nomic-embed-text
ollama serve
```

MemoryBox sends resized image bytes directly to Ollama's local `/api/chat` endpoint. It never sends a filename or a local path, and it does not call a cloud AI service. It uses Ollama's local `/api/embed` endpoint with `nomic-embed-text` for semantic vectors. The app checks `/api/tags` before batch work, so a missing model, connection failure, timeout, or malformed response leaves OCR search usable and shows a clear retryable failure.

Ollama normally permits loopback browser origins. If the browser displays a CORS failure, configure **only** the development origin, then restart the Ollama application/service. On Windows, set `OLLAMA_ORIGINS` to `http://127.0.0.1:5173,http://localhost:5173`; do not bind Ollama to a public network interface and do not use a wildcard origin. The exact restart method depends on whether Ollama is running as the desktop app or a service.

## Storage and privacy

OCR runs in a Web Worker in the browser. Tesseract may download its English OCR language package on first use; that request contains no screenshot content. Optional AI analysis and embeddings go only to `http://localhost:11434`, the Ollama service on the same device. The browser stores OCR text, validated AI metadata, local numeric embedding vectors, duplicate IDs, and a compact generated thumbnail in IndexedDB. It deliberately does **not** persist original full-size screenshots. New uploads are resized in memory for Gemma; after a reload, reanalysis uses the stored thumbnail. Use **Clear library** to remove all stored local records.

## Compatibility and limitations

Use a current Chromium browser (Chrome, Edge, or Brave) or Firefox with IndexedDB, Web Workers, Canvas, and `createImageBitmap` enabled. Safari support depends on its available browser-storage quota and image APIs. Tesseract works best for clear, high-contrast printed English text; handwriting, tiny text, and stylized layouts may index poorly. Indexing around 70–80 screenshots can take time and CPU because the demo processes one image at a time to stay responsive.

This MVP performs hybrid retrieval: weighted keyword matching across OCR and optional AI metadata plus cosine similarity over persisted local embeddings. It does not use cloud APIs, automatic folder indexing, continuous watching, native file opening, or original-image persistence across reloads. Gemma can make mistakes; the UI labels its metadata separately from raw OCR and preserves uncertainty fields rather than presenting guesses as facts.

## Roadmap: desktop edition

- Explicit opt-in desktop folder access and incremental indexing
- Local SQLite FTS search and cached thumbnails
- Continuous folder watching, pause/resume, and robust retry state
- Optional user-triggered local embeddings for semantic retrieval
- More languages and self-hosted OCR assets for offline first-use

## Validation

`npm test` includes OCR-text search, AI-metadata ranking, semantic-vector ranking, duplicate-ID, and JSON-validation tests. The UI build is independently typechecked and production-built with Vite.

Licensed under [MIT](LICENSE).
