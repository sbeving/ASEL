import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  notFound: boolean;
}

export interface OcrExtractionResult {
  text: string;
  engine: 'tesseract' | 'pdftotext' | 'plain' | 'none';
  warnings: string[];
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

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let resolved = false;
    let notFound = false;

    child.stdout.on('data', (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => err.push(Buffer.from(chunk)));

    child.on('error', (error) => {
      if (resolved) return;
      resolved = true;
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

export async function extractTextFromDocument(filePath: string, mimeType: string): Promise<OcrExtractionResult> {
  const warnings: string[] = [];
  const lowerMime = mimeType.toLowerCase();

  if (lowerMime === 'text/plain') {
    const text = await fs.readFile(filePath, 'utf8');
    return { text: normalizeText(text), engine: 'plain', warnings };
  }

  if (lowerMime === 'application/pdf') {
    const pdfToText = await runCommand('pdftotext', ['-layout', '-q', filePath, '-']);
    if (pdfToText.ok) {
      return { text: normalizeText(pdfToText.stdout), engine: 'pdftotext', warnings };
    }
    warnings.push(
      pdfToText.notFound
        ? 'pdftotext command is not available on server.'
        : `pdftotext failed with code ${String(pdfToText.code)}.`,
    );
  }

  const tesseract = await runCommand('tesseract', [filePath, 'stdout', '-l', 'eng+fra']);
  if (tesseract.ok) {
    return { text: normalizeText(tesseract.stdout), engine: 'tesseract', warnings };
  }

  warnings.push(
    tesseract.notFound
      ? 'tesseract command is not available on server.'
      : `tesseract failed with code ${String(tesseract.code)}.`,
  );
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

  const numberMatch = compact.match(
    /(?:bon(?:\s+de)?\s+reception|bon|br|bl|document|piece)\s*(?:n(?:umero|o|°|#)?)?\s*[:\-]?\s*([A-Z0-9/_-]{4,40})/i,
  );
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

function extractLineCandidates(text: string): Array<{
  rawText: string;
  productName: string;
  quantity: number;
  unitPriceHt: number;
  vatRate: number;
}> {
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
    if (/^(total|sous[-\s]?total|tva|montant|adresse|telephone|tel|fax)\b/i.test(line)) continue;

    const numbers = line.match(/\d+(?:[.,]\d+)?/g) ?? [];
    if (numbers.length < 2) continue;

    const quantity = parseDecimal(numbers[0] ?? '');
    const unitPrice = parseDecimal(numbers[1] ?? '');
    if (quantity <= 0 || quantity > 100000) continue;
    if (unitPrice < 0 || unitPrice > 1000000) continue;

    const vatMatch = line.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const vatRate = vatMatch?.[1] ? Math.min(100, Math.max(0, parseDecimal(vatMatch[1]))) : 19;

    const firstNumberIndex = line.search(/\d/);
    const productName = line.slice(0, Math.max(0, firstNumberIndex)).trim();
    if (productName.length < 2) continue;

    out.push({
      rawText: line,
      productName,
      quantity: Math.round(quantity * 1000) / 1000,
      unitPriceHt: Math.round(unitPrice * 1000) / 1000,
      vatRate,
    });
  }

  return out.slice(0, 60);
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
