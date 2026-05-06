// OCR engine wrapper around Tesseract.js (free, in-process WASM).
// No external API key needed; trades accuracy for cost.
//
// Three exports used by browser.tools.ts handlers:
//   - runOcr(imageBuffer, lang)              — OCR an image; returns text + bounding boxes
//   - findTextOnPage(imageBuffer, target)    — locate where on a page a text appears (returns center coords)
//   - fetchImageBuffer(url)                  — fetch a URL and return its bytes for OCR
//
// All functions are kept thin so they can be mocked easily in unit tests.
//
// Notes for callers:
//   - Tesseract.js downloads ~10MB of language data on first call (cached after).
//   - For best accuracy, supply screenshot at >=1080px wide. Browserbase default is fine.
//   - "lang" follows Tesseract codes (eng = English). Add "+hin" etc. for multi-script.

import { createWorker, type Worker } from 'tesseract.js';

import { createLogger } from '@/lib/logger';

const log = createLogger('OCR');

// Lazy worker — created on first OCR call, kept warm for subsequent calls
// in the same Node process (avoids re-loading WASM + lang data every call).
let cachedWorker: Worker | null = null;
let cachedLang: string | null = null;

async function getWorker(lang: string): Promise<Worker> {
  if (cachedWorker && cachedLang === lang) return cachedWorker;
  if (cachedWorker) {
    await cachedWorker.terminate().catch(() => {});
    cachedWorker = null;
  }
  log.info('Creating Tesseract worker', { lang });
  cachedWorker = await createWorker(lang);
  cachedLang = lang;
  return cachedWorker;
}

export interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}

export interface OcrResult {
  fullText: string;
  words: OcrWord[];
}

/** Run OCR on an image buffer. Returns extracted text + word-level bounding boxes. */
export async function runOcr(
  image: Buffer | string,
  lang = 'eng',
): Promise<OcrResult> {
  const worker = await getWorker(lang);
  const { data } = await worker.recognize(image);
  // Tesseract v7 nests words inside blocks > paragraphs > lines > words. Flatten:
  const words: OcrWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const w of line.words ?? []) {
          words.push({
            text: w.text,
            bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
            confidence: w.confidence,
          });
        }
      }
    }
  }
  return { fullText: data.text ?? '', words };
}

/** Find the on-screen center coordinates of a target text on the OCR'd page.
 *  Match strategy:
 *   1. Exact-text word match (case-insensitive)
 *   2. Multi-word phrase match (consecutive words)
 *   3. First substring match if nothing else hits
 *  Returns null if no usable match is found. */
export async function findTextOnPage(
  image: Buffer | string,
  target: string,
  lang = 'eng',
): Promise<{ x: number; y: number; matched: string; confidence: number } | null> {
  const result = await runOcr(image, lang);
  const norm = target.trim().toLowerCase();
  if (!norm) return null;

  // 1. Exact single-word match
  const exact = result.words.find((w) => w.text.toLowerCase() === norm);
  if (exact) {
    return {
      x: Math.round((exact.bbox.x0 + exact.bbox.x1) / 2),
      y: Math.round((exact.bbox.y0 + exact.bbox.y1) / 2),
      matched: exact.text,
      confidence: exact.confidence,
    };
  }

  // 2. Multi-word phrase match
  const targetWords = norm.split(/\s+/);
  if (targetWords.length > 1) {
    for (let i = 0; i <= result.words.length - targetWords.length; i++) {
      const slice = result.words.slice(i, i + targetWords.length);
      const text = slice.map((w) => w.text.toLowerCase()).join(' ');
      if (text === norm) {
        const minX0 = Math.min(...slice.map((s) => s.bbox.x0));
        const maxX1 = Math.max(...slice.map((s) => s.bbox.x1));
        const minY0 = Math.min(...slice.map((s) => s.bbox.y0));
        const maxY1 = Math.max(...slice.map((s) => s.bbox.y1));
        const avgConf = slice.reduce((sum, s) => sum + s.confidence, 0) / slice.length;
        return {
          x: Math.round((minX0 + maxX1) / 2),
          y: Math.round((minY0 + maxY1) / 2),
          matched: slice.map((s) => s.text).join(' '),
          confidence: avgConf,
        };
      }
    }
  }

  // 3. Substring match — first word containing the target
  const substr = result.words.find((w) => w.text.toLowerCase().includes(norm));
  if (substr) {
    return {
      x: Math.round((substr.bbox.x0 + substr.bbox.x1) / 2),
      y: Math.round((substr.bbox.y0 + substr.bbox.y1) / 2),
      matched: substr.text,
      confidence: substr.confidence,
    };
  }

  return null;
}

/** Fetch an image URL and return raw bytes for OCR. */
export async function fetchImageBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status}): ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Tear down the cached worker. Call this in long-lived processes during shutdown. */
export async function shutdownOcr(): Promise<void> {
  if (cachedWorker) {
    await cachedWorker.terminate().catch(() => {});
    cachedWorker = null;
    cachedLang = null;
  }
}
