import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import sharp from 'sharp';
import Ocr from '@repeato/ocr';
import { Mistral } from '@mistralai/mistralai';
import { env } from '../config/env.js';

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  notFound: boolean;
}

type LocalOcrEngine = Awaited<ReturnType<typeof Ocr.create>>;

interface PaddleLine {
  text: string;
  mean?: number;
  score?: number;
  frame?: {
    top?: number;
    left?: number;
    width?: number;
    height?: number;
  };
  box?: Array<[number, number]>;
}

let localOcrPromise: Promise<LocalOcrEngine> | null = null;

function getLocalOcr() {
  localOcrPromise ??= Ocr.create({
    onnxOptions: {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    },
  });
  return localOcrPromise;
}

export interface OcrExtractionResult {
  text: string;
  engine: 'google_aistudio' | 'mistral' | 'paddle' | 'http' | 'pdftotext' | 'plain' | 'none';
  warnings: string[];
  confidence?: number | null;
  pageCount?: number;
}

export interface OcrExtractionOptions {
  googleAiStudioApiKey?: string | null;
  allowSharedProviders?: boolean;
}

export interface OcrProductCandidate {
  id: string;
  name: string;
  reference?: string | null;
  barcode?: string | null;
}

export interface OcrSuggestedLine {
  rawText: string;
  productName: string;
  productId: string | null;
  quantity: number;
  unitPriceHt: number;
  vatRate: number;
  confidence: number;
}

export interface ReceptionOcrSuggestion {
  header: {
    number?: string;
    receptionDate?: string;
    supplierName?: string;
  };
  lines: OcrSuggestedLine[];
}

async function runCommand(command: string, args: string[], timeoutMs = 120_000): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let resolved = false;
    let notFound = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      child.kill('SIGTERM');
      resolve({
        ok: false,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: `Command timed out after ${timeoutMs}ms.`,
        code: null,
        signal: 'SIGTERM',
        notFound: false,
      });
    }, timeoutMs);

    child.stdout.on('data', (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => err.push(Buffer.from(chunk)));

    child.on('error', (error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') notFound = true;
      resolve({
        ok: false,
        stdout: '',
        stderr: error.message,
        code: null,
        signal: null,
        notFound,
      });
    });

    child.on('close', (code, signal) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        stdout: Buffer.concat(out).toString('utf8'),
        stderr: Buffer.concat(err).toString('utf8'),
        code,
        signal,
        notFound,
      });
    });
  });
}

function normalizeText(text: string): string {
  return text.replace(/\u0000/g, '').replace(/\r/g, '').trim();
}

function isImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/');
}

function isPdfMime(mimeType: string): boolean {
  return mimeType.toLowerCase() === 'application/pdf';
}

function dataUrl(mimeType: string, buffer: Buffer): string {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function tempFilePath(extension: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'asel-ocr-'));
  return path.join(dir, `${crypto.randomUUID()}${extension}`);
}

async function removeTempFile(filePath: string) {
  try {
    await fs.rm(path.dirname(filePath), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

async function preprocessImage(filePath: string, warnings: string[]): Promise<string> {
  const output = await tempFilePath('.png');
  try {
    await sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize({
        width: env.OCR_PREPROCESS_MAX_EDGE,
        height: env.OCR_PREPROCESS_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .greyscale()
      .normalize()
      .sharpen({ sigma: 1.1, m1: 1.2, m2: 2.0 })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(output);
    return output;
  } catch (error) {
    warnings.push(`Image preprocessing skipped: ${error instanceof Error ? error.message : 'unknown error'}.`);
    await removeTempFile(output);
    return filePath;
  }
}

function lineTop(line: PaddleLine): number {
  if (Number.isFinite(line.frame?.top)) return Number(line.frame?.top);
  const yValues = line.box?.map((point) => point[1]).filter((value) => Number.isFinite(value)) ?? [];
  return yValues.length > 0 ? Math.min(...yValues) : 0;
}

function lineLeft(line: PaddleLine): number {
  if (Number.isFinite(line.frame?.left)) return Number(line.frame?.left);
  const xValues = line.box?.map((point) => point[0]).filter((value) => Number.isFinite(value)) ?? [];
  return xValues.length > 0 ? Math.min(...xValues) : 0;
}

function textFromPaddleLines(lines: PaddleLine[]): string {
  const sorted = [...lines].sort((left, right) => {
    const yDiff = lineTop(left) - lineTop(right);
    return Math.abs(yDiff) > 10 ? yDiff : lineLeft(left) - lineLeft(right);
  });
  return normalizeText(sorted.map((line) => line.text).filter(Boolean).join('\n'));
}

function extractTextFromProviderPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const data = payload as Record<string, unknown>;
  const direct = data.text ?? data.Text ?? data.parsedText ?? data.ParsedText;
  if (typeof direct === 'string') return direct;

  const parsedResults = data.ParsedResults ?? data.parsedResults;
  if (Array.isArray(parsedResults)) {
    return parsedResults
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return '';
        const row = entry as Record<string, unknown>;
        return typeof row.ParsedText === 'string' ? row.ParsedText : typeof row.text === 'string' ? row.text : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  const pages = data.pages ?? data.Pages;
  if (Array.isArray(pages)) {
    return pages
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return '';
        const row = entry as Record<string, unknown>;
        return typeof row.text === 'string' ? row.text : typeof row.Text === 'string' ? row.Text : '';
      })
      .filter(Boolean)
      .join('\n');
  }

  return '';
}

function extractTextFromGeminiPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const data = payload as Record<string, unknown>;
  const candidates = data.candidates;
  if (!Array.isArray(candidates)) return '';

  return normalizeText(
    candidates
      .map((candidate) => {
        if (!candidate || typeof candidate !== 'object') return '';
        const content = (candidate as Record<string, unknown>).content;
        if (!content || typeof content !== 'object') return '';
        const parts = (content as Record<string, unknown>).parts;
        if (!Array.isArray(parts)) return '';
        return parts
          .map((part) => {
            if (!part || typeof part !== 'object') return '';
            const text = (part as Record<string, unknown>).text;
            return typeof text === 'string' ? text : '';
          })
          .filter(Boolean)
          .join('\n');
      })
      .filter(Boolean)
      .join('\n\n'),
  );
}

function geminiErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== 'object') return null;
  const message = (error as Record<string, unknown>).message;
  return typeof message === 'string' ? message : null;
}

async function extractWithGoogleAiStudioProvider(
  filePath: string,
  mimeType: string,
  apiKey: string | null | undefined,
  warnings: string[],
): Promise<string | null> {
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);

  try {
    const buffer = await fs.readFile(filePath);
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'Extract all readable text from this supplier invoice or reception document. ' +
                  'Preserve product lines, references, barcodes, quantities, unit prices, totals, dates, and supplier names. ' +
                  'Return only plain text and markdown tables. Do not add commentary.',
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: buffer.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'text/plain',
        },
      }),
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      warnings.push(
        `Google AI Studio OCR failed with status ${response.status}${geminiErrorMessage(payload) ? `: ${geminiErrorMessage(payload)}` : ''}.`,
      );
      return null;
    }

    const text = typeof payload === 'string' ? payload : extractTextFromGeminiPayload(payload);
    return normalizeText(text);
  } catch (error) {
    warnings.push(`Google AI Studio OCR failed: ${error instanceof Error ? error.message : 'unknown error'}.`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function extractWithHttpProvider(filePath: string, mimeType: string, warnings: string[]): Promise<string | null> {
  if (!env.OCR_HTTP_ENDPOINT) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);

  try {
    const buffer = await fs.readFile(filePath);
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), 'document');
    form.append('language', 'fra,eng');

    const response = await fetch(env.OCR_HTTP_ENDPOINT, {
      method: 'POST',
      headers: env.OCR_HTTP_API_KEY ? { Authorization: `Bearer ${env.OCR_HTTP_API_KEY}` } : undefined,
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      warnings.push(`OCR HTTP provider failed with status ${response.status}.`);
      return null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return normalizeText(extractTextFromProviderPayload(await response.json()));
    }
    return normalizeText(await response.text());
  } catch (error) {
    warnings.push(`OCR HTTP provider failed: ${error instanceof Error ? error.message : 'unknown error'}.`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function extractWithMistralProvider(filePath: string, mimeType: string, warnings: string[]) {
  if (!env.MISTRAL_API_KEY) return null;

  try {
    const client = new Mistral({
      apiKey: env.MISTRAL_API_KEY,
      timeoutMs: 180_000,
    });
    const buffer = await fs.readFile(filePath);
    const fileName = path.basename(filePath);
    const document = isImageMime(mimeType)
      ? {
          type: 'image_url' as const,
          imageUrl: dataUrl(mimeType, buffer),
        }
      : {
          type: 'file' as const,
          fileId: (
            await client.files.upload({
              purpose: 'ocr',
              file: {
                fileName,
                content: new Blob([buffer], { type: mimeType }),
              },
            })
          ).id,
        };

    const response = await client.ocr.process(
      {
        model: env.MISTRAL_OCR_MODEL,
        document,
        tableFormat: 'markdown',
        extractHeader: true,
        extractFooter: false,
        includeImageBase64: false,
        confidenceScoresGranularity: 'page',
      },
      { timeoutMs: 180_000 },
    );

    const text = normalizeText(
      response.pages
        .map((page) => [page.header, page.markdown].filter(Boolean).join('\n'))
        .filter(Boolean)
        .join('\n\n'),
    );
    const confidences = response.pages
      .map((page) => page.confidenceScores?.averagePageConfidenceScore)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    return {
      text,
      confidence: average(confidences),
      pageCount: response.pages.length,
    };
  } catch (error) {
    warnings.push(`Mistral OCR failed: ${error instanceof Error ? error.message : 'unknown error'}.`);
    return null;
  }
}

async function extractWithPaddleProvider(filePath: string, mimeType: string, warnings: string[]) {
  if (!env.OCR_LOCAL_ENABLED || !isImageMime(mimeType)) return null;

  let processedPath = filePath;
  try {
    processedPath = await preprocessImage(filePath, warnings);
    const ocr = await withTimeout(getLocalOcr(), 90_000, 'PaddleOCR model load');
    const result = await withTimeout(ocr.detect(processedPath), 180_000, 'PaddleOCR detection');
    const lines = (result.texts ?? []) as PaddleLine[];
    const text = textFromPaddleLines(lines);
    const confidences = lines
      .map((line) => (typeof line.mean === 'number' ? line.mean : typeof line.score === 'number' ? line.score : null))
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    return {
      text,
      confidence: average(confidences),
      pageCount: 1,
    };
  } catch (error) {
    warnings.push(`Local PaddleOCR failed: ${error instanceof Error ? error.message : 'unknown error'}.`);
    return null;
  } finally {
    if (processedPath !== filePath) await removeTempFile(processedPath);
  }
}

export async function extractTextFromDocument(
  filePath: string,
  mimeType: string,
  options: OcrExtractionOptions = {},
): Promise<OcrExtractionResult> {
  const warnings: string[] = [];
  const lowerMime = mimeType.toLowerCase();

  if (lowerMime === 'text/plain') {
    const text = await fs.readFile(filePath, 'utf8');
    return { text: normalizeText(text), engine: 'plain', warnings };
  }

  const googleAiStudioText = await extractWithGoogleAiStudioProvider(filePath, mimeType, options.googleAiStudioApiKey, warnings);
  if (googleAiStudioText) {
    return { text: googleAiStudioText, engine: 'google_aistudio', warnings };
  }

  if (options.allowSharedProviders !== false) {
    const mistralText = await extractWithMistralProvider(filePath, mimeType, warnings);
    if (mistralText?.text) {
      return { text: mistralText.text, engine: 'mistral', warnings, confidence: mistralText.confidence, pageCount: mistralText.pageCount };
    }

    const httpText = await extractWithHttpProvider(filePath, mimeType, warnings);
    if (httpText) {
      return { text: httpText, engine: 'http', warnings };
    }
  }

  if (lowerMime === 'application/pdf') {
    const pdfToText = await runCommand('pdftotext', ['-layout', '-q', filePath, '-'], 60_000);
    if (pdfToText.ok) {
      return { text: normalizeText(pdfToText.stdout), engine: 'pdftotext', warnings };
    }
    warnings.push(
      pdfToText.notFound
        ? 'pdftotext command is not available on server.'
        : `pdftotext failed with code ${String(pdfToText.code)}.`,
    );
  }

  const paddleText = await extractWithPaddleProvider(filePath, mimeType, warnings);
  if (paddleText?.text) {
    return { text: paddleText.text, engine: 'paddle', warnings, confidence: paddleText.confidence, pageCount: paddleText.pageCount };
  }

  if (isPdfMime(mimeType) && !options.googleAiStudioApiKey) {
    warnings.push('Scanned PDF OCR needs a Google AI Studio key on the user account; digital PDF text extraction already attempted.');
  } else if (isPdfMime(mimeType) && options.allowSharedProviders === false) {
    warnings.push('Shared OCR providers are disabled for user-paid OCR; digital PDF text extraction already attempted.');
  } else if (isPdfMime(mimeType) && !env.MISTRAL_API_KEY) {
    warnings.push('Scanned PDF OCR fallback needs MISTRAL_API_KEY; digital PDF text extraction already attempted.');
  }
  return { text: '', engine: 'none', warnings };
}

function parseDecimal(value: string): number {
  const parsed = Number(value.replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreProductMatch(rawLine: string, productNameGuess: string, candidate: OcrProductCandidate): number {
  const line = normalizeForSearch(rawLine);
  const guess = normalizeForSearch(productNameGuess);
  const name = normalizeForSearch(candidate.name);
  const reference = normalizeForSearch(candidate.reference ?? '');
  const barcode = normalizeForSearch(candidate.barcode ?? '');

  let score = 0;
  if (reference && line.includes(reference)) score += 1.2;
  if (barcode && line.includes(barcode)) score += 1.2;
  if (name && line.includes(name)) score += 1.0;
  if (guess && name && (guess.includes(name) || name.includes(guess))) score += 0.8;

  const tokens = guess.split(' ').filter((token) => token.length >= 3);
  if (tokens.length > 0) {
    const hits = tokens.filter((token) => name.includes(token)).length;
    score += (hits / tokens.length) * 0.6;
  }

  return score;
}

function extractHeader(text: string): ReceptionOcrSuggestion['header'] {
  const header: ReceptionOcrSuggestion['header'] = {};
  const compact = text.slice(0, 6000);

  const numberPatterns = [
    /(?:bon(?:[^\S\r\n]+de)?[^\S\r\n]+reception|bon|br|bl|document|piece|facture)[^\S\r\n]*(?:n(?:umero|o)?|n°|°|#)[^\S\r\n]*[:#-]?[^\S\r\n]*([A-Z0-9][A-Z0-9/_-]{3,39})/i,
    /(?:bon(?:[^\S\r\n]+de)?[^\S\r\n]+reception|bon|br|bl|document|piece|facture)[^\S\r\n]*[:#-][^\S\r\n]*([A-Z0-9][A-Z0-9/_-]{3,39})/i,
  ];
  const numberMatch = numberPatterns.map((pattern) => compact.match(pattern)).find(Boolean);
  const number = numberMatch?.[1];
  if (number) header.number = number;

  const dateFr = compact.match(/\b([0-3]?\d)[\/.-]([01]?\d)[\/.-]((?:20)?\d{2})\b/);
  if (dateFr) {
    const dayRaw = dateFr[1] ?? '';
    const monthRaw = dateFr[2] ?? '';
    const yearRaw = dateFr[3] ?? '';
    if (dayRaw && monthRaw && yearRaw) {
      const day = dayRaw.padStart(2, '0');
      const month = monthRaw.padStart(2, '0');
      const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
      header.receptionDate = `${year}-${month}-${day}`;
    }
  } else {
    const dateIso = compact.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (dateIso?.[0]) header.receptionDate = dateIso[0];
  }

  const supplierMatch = compact.match(/(?:fournisseur|supplier|vendor)\s*[:\-]\s*([^\n\r]{2,100})/i);
  const supplierName = supplierMatch?.[1]?.trim();
  if (supplierName) header.supplierName = supplierName;

  return header;
}

function stripMarkdownCell(value: string): string {
  return value
    .replace(/[*_`]/g, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMarkdownSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()));
}

function tableLineCandidates(text: string): Array<{
  rawText: string;
  productName: string;
  quantity: number;
  unitPriceHt: number;
  vatRate: number;
}> {
  const out: Array<{
    rawText: string;
    productName: string;
    quantity: number;
    unitPriceHt: number;
    vatRate: number;
  }> = [];

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.includes('|')) continue;

    const cells = line
      .split('|')
      .map(stripMarkdownCell)
      .filter(Boolean);
    if (cells.length < 3 || isMarkdownSeparator(cells)) continue;
    if (cells.some((cell) => /^(designation|article|produit|qty|qte|quantite|prix|total|tva)$/i.test(cell))) continue;

    const numericCells = cells
      .map((cell, index) => ({ index, value: parseDecimal(cell.replace(/[^\d,.-]/g, '')) }))
      .filter((cell) => Number.isFinite(cell.value) && cell.value > 0);
    if (numericCells.length < 2) continue;

    const firstNumericIndex = numericCells[0]?.index ?? -1;
    const nameCells = cells.slice(0, firstNumericIndex).filter((cell) => /[a-zA-Z]/.test(cell));
    const productName = nameCells.join(' ').trim();
    if (productName.length < 2) continue;

    const quantity = numericCells[0]?.value ?? 0;
    const unitPrice = numericCells[1]?.value ?? 0;
    const vatCell = cells.find((cell) => /\d+(?:[.,]\d+)?\s*%/.test(cell));
    const vatRate = vatCell ? Math.min(100, Math.max(0, parseDecimal(vatCell))) : 19;

    out.push({
      rawText: cells.join(' | '),
      productName,
      quantity: Math.round(quantity * 1000) / 1000,
      unitPriceHt: Math.round(unitPrice * 1000) / 1000,
      vatRate,
    });
  }

  return out;
}

function isNonProductLine(line: string): boolean {
  return /^(bon\b|facture\b|date\b|fournisseur\b|supplier\b|vendor\b|client\b|total\b|sous[-\s]?total\b|tva\b|montant\b|adresse\b|telephone\b|tel\b|fax\b)/i.test(
    line,
  );
}

function parsePlainProductLine(line: string): {
  rawText: string;
  productName: string;
  quantity: number;
  unitPriceHt: number;
  vatRate: number;
} | null {
  const withoutCurrency = line
    .replace(/\b(?:tnd|dt|eur|usd|ht|ttc)\b/gi, ' ')
    .replace(/[€$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tailMatch = withoutCurrency.match(
    /^(.+?)\s+(\d+(?:[.,]\d{1,3})?)\s+(\d+(?:[.,]\d{1,3})?)(?:\s+\d+(?:[.,]\d{1,3})?)?\s*$/,
  );
  if (!tailMatch?.[1] || !tailMatch[2] || !tailMatch[3]) return null;

  const productName = tailMatch[1].trim();
  if (productName.length < 2 || !/[a-zA-Z]/.test(productName)) return null;

  const quantity = parseDecimal(tailMatch[2]);
  const unitPrice = parseDecimal(tailMatch[3]);
  if (quantity <= 0 || quantity > 100000 || unitPrice < 0 || unitPrice > 1000000) return null;

  const vatMatch = line.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const vatRate = vatMatch?.[1] ? Math.min(100, Math.max(0, parseDecimal(vatMatch[1]))) : 19;

  return {
    rawText: line,
    productName,
    quantity: Math.round(quantity * 1000) / 1000,
    unitPriceHt: Math.round(unitPrice * 1000) / 1000,
    vatRate,
  };
}

function extractLineCandidates(text: string): Array<{
  rawText: string;
  productName: string;
  quantity: number;
  unitPriceHt: number;
  vatRate: number;
}> {
  const tableCandidates = tableLineCandidates(text);
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 6 && line.length <= 180);

  const out: Array<{
    rawText: string;
    productName: string;
    quantity: number;
    unitPriceHt: number;
    vatRate: number;
  }> = [];

  for (const line of lines) {
    if (!/[a-zA-Z]/.test(line) || !/\d/.test(line)) continue;
    if (isNonProductLine(line)) continue;

    const parsed = parsePlainProductLine(line);
    if (parsed) out.push(parsed);
  }

  return [...tableCandidates, ...out].slice(0, 80);
}

export function parseReceptionOcr(text: string, products: OcrProductCandidate[]): ReceptionOcrSuggestion {
  const header = extractHeader(text);
  const lineCandidates = extractLineCandidates(text);
  const suggestions: OcrSuggestedLine[] = [];
  const seen = new Set<string>();

  for (const line of lineCandidates) {
    let bestProduct: OcrProductCandidate | null = null;
    let bestScore = 0;

    for (const candidate of products) {
      const score = scoreProductMatch(line.rawText, line.productName, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestProduct = candidate;
      }
    }

    const dedupeKey = `${line.productName}-${line.quantity}-${line.unitPriceHt}-${line.vatRate}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    suggestions.push({
      rawText: line.rawText,
      productName: line.productName,
      productId: bestScore >= 0.8 ? bestProduct?.id ?? null : null,
      quantity: line.quantity,
      unitPriceHt: line.unitPriceHt,
      vatRate: line.vatRate,
      confidence: Math.min(1, bestScore / 2),
    });
  }

  return { header, lines: suggestions.slice(0, 30) };
}
