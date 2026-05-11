import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import sharp from "sharp";
import Ocr from "@repeato/ocr";
import { env } from "../config/env.js";

interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  notFound: boolean;
}

type LocalOcrEngine = Awaited<ReturnType<typeof Ocr.create>>;
type OcrEngine =
  | "local_pdf"
  | "paddle"
  | "tesseract"
  | "paddle+tesseract"
  | "pdftotext"
  | "plain"
  | "none";

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

interface ImageVariant {
  path: string;
  label: string;
  cleanup: boolean;
}

interface TextCandidate {
  text: string;
  engine: OcrEngine;
  confidence?: number | null;
  pageCount?: number;
  label?: string;
}

let localOcrPromise: Promise<LocalOcrEngine> | null = null;

function getLocalOcr() {
  localOcrPromise ??= Ocr.create({
    onnxOptions: {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    },
  });
  return localOcrPromise;
}

export interface OcrExtractionResult {
  text: string;
  engine: OcrEngine;
  warnings: string[];
  confidence?: number | null;
  pageCount?: number;
}

export interface OcrExtractionOptions {
  maxPdfPages?: number;
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

export interface OcrDuplicateCandidate {
  id: string;
  number: string;
  supplierName?: string | null;
  receptionDate?: string | null;
  totalTtc: number;
  status: string;
  score: number;
  reasons: string[];
}

export interface OcrReviewSummary {
  status: "auto_approved" | "needs_review";
  minimumConfidence: number;
  lowConfidenceLineIndexes: number[];
  unmatchedLineIndexes: number[];
  duplicateCandidates: OcrDuplicateCandidate[];
  reasons: string[];
}

export interface ReceptionOcrSuggestion {
  header: {
    number?: string;
    receptionDate?: string;
    supplierName?: string;
  };
  lines: OcrSuggestedLine[];
}

export const OCR_LINE_CONFIDENCE_REVIEW_THRESHOLD = 0.65;

async function runCommand(
  command: string,
  args: string[],
  timeoutMs = 120_000,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let resolved = false;
    let notFound = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      child.kill("SIGTERM");
      resolve({
        ok: false,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: `Command timed out after ${timeoutMs}ms.`,
        code: null,
        signal: "SIGTERM",
        notFound: false,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));

    child.on("error", (error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") notFound = true;
      resolve({
        ok: false,
        stdout: "",
        stderr: error.message,
        code: null,
        signal: null,
        notFound,
      });
    });

    child.on("close", (code, signal) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code,
        signal,
        notFound,
      });
    });
  });
}

function normalizeText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .trim();
}

function isImageMime(mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith("image/");
}

function isPdfMime(mimeType: string): boolean {
  return mimeType.toLowerCase() === "application/pdf";
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return (
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 1000,
    ) / 1000
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function tempDir(prefix = "asel-ocr-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function tempFilePath(extension: string): Promise<string> {
  const dir = await tempDir();
  return path.join(dir, `${crypto.randomUUID()}${extension}`);
}

async function removeTempPath(fileOrDir: string) {
  try {
    await fs.rm(fileOrDir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

async function removeTempFile(filePath: string) {
  await removeTempPath(path.dirname(filePath));
}

async function writePreprocessedVariant(
  filePath: string,
  mode: "clean" | "contrast" | "binary",
): Promise<ImageVariant> {
  const output = await tempFilePath(".png");
  let pipeline = sharp(filePath, { failOn: "none" })
    .rotate()
    .resize({
      width: env.OCR_PREPROCESS_MAX_EDGE,
      height: env.OCR_PREPROCESS_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .greyscale()
    .normalize();

  if (mode === "contrast") {
    pipeline = pipeline
      .linear(1.25, -12)
      .sharpen({ sigma: 1.2, m1: 1.4, m2: 2.1 });
  } else if (mode === "binary") {
    pipeline = pipeline
      .threshold(165)
      .sharpen({ sigma: 1.0, m1: 1.1, m2: 1.8 });
  } else {
    pipeline = pipeline.sharpen({ sigma: 1.1, m1: 1.2, m2: 2.0 });
  }

  await pipeline
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(output);
  return { path: output, label: mode, cleanup: true };
}

async function preprocessImageVariants(
  filePath: string,
  warnings: string[],
): Promise<ImageVariant[]> {
  const variants: ImageVariant[] = [
    { path: filePath, label: "original", cleanup: false },
  ];
  for (const mode of ["clean", "contrast", "binary"] as const) {
    try {
      variants.push(await writePreprocessedVariant(filePath, mode));
    } catch (error) {
      warnings.push(
        `Image preprocessing variant ${mode} skipped: ${error instanceof Error ? error.message : "unknown error"}.`,
      );
    }
  }
  return variants;
}

async function cleanupVariants(variants: ImageVariant[]) {
  await Promise.all(
    variants
      .filter((variant) => variant.cleanup)
      .map((variant) => removeTempFile(variant.path)),
  );
}

function lineTop(line: PaddleLine): number {
  if (Number.isFinite(line.frame?.top)) return Number(line.frame?.top);
  const yValues =
    line.box
      ?.map((point) => point[1])
      .filter((value) => Number.isFinite(value)) ?? [];
  return yValues.length > 0 ? Math.min(...yValues) : 0;
}

function lineLeft(line: PaddleLine): number {
  if (Number.isFinite(line.frame?.left)) return Number(line.frame?.left);
  const xValues =
    line.box
      ?.map((point) => point[0])
      .filter((value) => Number.isFinite(value)) ?? [];
  return xValues.length > 0 ? Math.min(...xValues) : 0;
}

function textFromPaddleLines(lines: PaddleLine[]): string {
  const sorted = [...lines].sort((left, right) => {
    const yDiff = lineTop(left) - lineTop(right);
    return Math.abs(yDiff) > 10 ? yDiff : lineLeft(left) - lineLeft(right);
  });
  return normalizeText(
    sorted
      .map((line) => line.text)
      .filter(Boolean)
      .join("\n"),
  );
}

function tesseractTsvToText(tsv: string): {
  text: string;
  confidence: number | null;
} {
  const rows = tsv.split(/\n/).filter(Boolean);
  const header = rows.shift()?.split("\t") ?? [];
  const index = (name: string) => header.indexOf(name);
  const lineKeyFields = ["page_num", "block_num", "par_num", "line_num"].map(
    index,
  );
  const textIndex = index("text");
  const confIndex = index("conf");
  if (
    textIndex < 0 ||
    confIndex < 0 ||
    lineKeyFields.some((field) => field < 0)
  ) {
    return { text: normalizeText(tsv), confidence: null };
  }

  const grouped = new Map<string, string[]>();
  const confidences: number[] = [];
  for (const row of rows) {
    const cells = row.split("\t");
    const word = cells[textIndex]?.trim();
    if (!word) continue;

    const confidence = Number(cells[confIndex]);
    if (Number.isFinite(confidence) && confidence >= 0)
      confidences.push(Math.min(1, Math.max(0, confidence / 100)));

    const key = lineKeyFields.map((field) => cells[field] ?? "0").join(":");
    const bucket = grouped.get(key) ?? [];
    bucket.push(word);
    grouped.set(key, bucket);
  }

  return {
    text: normalizeText(
      [...grouped.values()].map((words) => words.join(" ")).join("\n"),
    ),
    confidence: average(confidences),
  };
}

function textQualityScore(
  candidate: Pick<TextCandidate, "text" | "confidence">,
): number {
  const text = normalizeText(candidate.text);
  if (!text) return 0;
  const alnum = (text.match(/[a-z0-9]/gi) ?? []).length;
  const numeric = (text.match(/\d/g) ?? []).length;
  const lines = text
    .split("\n")
    .filter((line) => line.trim().length >= 3).length;
  return (
    text.length +
    alnum * 0.2 +
    numeric * 1.5 +
    lines * 35 +
    (candidate.confidence ?? 0) * 700
  );
}

function bestCandidate(
  candidates: Array<TextCandidate | null | undefined>,
): TextCandidate | null {
  const available = candidates.filter((candidate): candidate is TextCandidate =>
    Boolean(candidate?.text?.trim()),
  );
  if (available.length === 0) return null;
  return (
    available.sort(
      (left, right) => textQualityScore(right) - textQualityScore(left),
    )[0] ?? null
  );
}

function mergeUniqueLines(texts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of texts) {
    for (const rawLine of normalizeText(text).split("\n")) {
      const line = rawLine.replace(/\s+/g, " ").trim();
      if (line.length < 2) continue;
      const key = normalizeForSearch(line);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(line);
    }
  }
  return normalizeText(out.join("\n"));
}

async function extractWithPaddleProvider(
  filePath: string,
  mimeType: string,
  warnings: string[],
): Promise<TextCandidate | null> {
  if (!env.OCR_LOCAL_ENABLED || !isImageMime(mimeType)) return null;

  const variants = await preprocessImageVariants(filePath, warnings);
  try {
    const ocr = await withTimeout(
      getLocalOcr(),
      90_000,
      "Local PaddleOCR model load",
    );
    const candidates: TextCandidate[] = [];
    for (const variant of variants) {
      try {
        const result = await withTimeout(
          ocr.detect(variant.path),
          180_000,
          `Local PaddleOCR detection (${variant.label})`,
        );
        const lines = (result.texts ?? []) as PaddleLine[];
        const text = textFromPaddleLines(lines);
        const confidences = lines
          .map((line) =>
            typeof line.mean === "number"
              ? line.mean
              : typeof line.score === "number"
                ? line.score
                : null,
          )
          .filter(
            (value): value is number =>
              typeof value === "number" && Number.isFinite(value),
          );
        if (text) {
          candidates.push({
            text,
            engine: "paddle",
            confidence: average(confidences),
            pageCount: 1,
            label: variant.label,
          });
        }
      } catch (error) {
        warnings.push(
          `Local PaddleOCR ${variant.label} failed: ${error instanceof Error ? error.message : "unknown error"}.`,
        );
      }
    }
    return bestCandidate(candidates);
  } catch (error) {
    warnings.push(
      `Local PaddleOCR unavailable: ${error instanceof Error ? error.message : "unknown error"}.`,
    );
    return null;
  } finally {
    await cleanupVariants(variants);
  }
}

async function extractWithTesseractProvider(
  filePath: string,
  mimeType: string,
  warnings: string[],
): Promise<TextCandidate | null> {
  if (!env.OCR_LOCAL_ENABLED || !isImageMime(mimeType)) return null;

  const variants = await preprocessImageVariants(filePath, warnings);
  const candidates: TextCandidate[] = [];
  let missingCommand = false;
  try {
    for (const variant of variants) {
      const result = await runCommand(
        "tesseract",
        [variant.path, "stdout", "-l", "fra+eng", "--psm", "6", "tsv"],
        180_000,
      );
      if (result.notFound) {
        missingCommand = true;
        break;
      }
      if (!result.ok) {
        warnings.push(
          `Local Tesseract ${variant.label} failed with code ${String(result.code)}.`,
        );
        continue;
      }
      const parsed = tesseractTsvToText(result.stdout);
      if (parsed.text) {
        candidates.push({
          text: parsed.text,
          engine: "tesseract",
          confidence: parsed.confidence,
          pageCount: 1,
          label: variant.label,
        });
      }
    }
  } finally {
    await cleanupVariants(variants);
  }

  if (missingCommand) {
    warnings.push("Local Tesseract is not installed on this server.");
  }

  return bestCandidate(candidates);
}

async function extractWithLocalImageOcr(
  filePath: string,
  mimeType: string,
  warnings: string[],
): Promise<TextCandidate | null> {
  const paddle = await extractWithPaddleProvider(filePath, mimeType, warnings);
  const tesseract = await extractWithTesseractProvider(
    filePath,
    mimeType,
    warnings,
  );
  const combinedText = mergeUniqueLines([
    paddle?.text ?? "",
    tesseract?.text ?? "",
  ]);
  const combinedConfidence = average(
    [paddle?.confidence, tesseract?.confidence].filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    ),
  );

  const combined =
    combinedText && paddle?.text && tesseract?.text
      ? {
          text: combinedText,
          engine: "paddle+tesseract" as const,
          confidence: combinedConfidence,
          pageCount: 1,
        }
      : null;

  return bestCandidate([combined, paddle, tesseract]);
}

function hasUsefulDigitalPdfText(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return compact.length >= 80 && /\d/.test(compact) && /[a-z]/i.test(compact);
}

async function rasterizePdf(
  filePath: string,
  maxPages: number,
  warnings: string[],
): Promise<{ dir: string; pages: string[] } | null> {
  const dir = await tempDir("asel-ocr-pdf-");
  const prefix = path.join(dir, "page");
  const result = await runCommand(
    "pdftoppm",
    ["-png", "-r", "220", "-f", "1", "-l", String(maxPages), filePath, prefix],
    180_000,
  );
  if (!result.ok) {
    await removeTempPath(dir);
    warnings.push(
      result.notFound
        ? "pdftoppm command is not available on server."
        : `pdftoppm failed with code ${String(result.code)}.`,
    );
    return null;
  }

  const entries = await fs.readdir(dir);
  const pages = entries
    .filter((entry) => /^page-\d+\.png$/i.test(entry))
    .sort((left, right) => {
      const leftNo = Number(left.match(/\d+/)?.[0] ?? 0);
      const rightNo = Number(right.match(/\d+/)?.[0] ?? 0);
      return leftNo - rightNo;
    })
    .map((entry) => path.join(dir, entry));

  if (pages.length === 0) {
    await removeTempPath(dir);
    warnings.push("PDF rasterization produced no pages.");
    return null;
  }

  return { dir, pages };
}

async function extractWithPdfRasterOcr(
  filePath: string,
  warnings: string[],
  maxPages: number,
): Promise<TextCandidate | null> {
  const raster = await rasterizePdf(filePath, maxPages, warnings);
  if (!raster) return null;

  const pageCandidates: TextCandidate[] = [];
  try {
    for (const [index, pagePath] of raster.pages.entries()) {
      const page = await extractWithLocalImageOcr(
        pagePath,
        "image/png",
        warnings,
      );
      if (page?.text) {
        pageCandidates.push({
          ...page,
          pageCount: 1,
          label: `page-${index + 1}`,
        });
      }
    }
  } finally {
    await removeTempPath(raster.dir);
  }

  if (pageCandidates.length === 0) return null;
  return {
    text: mergeUniqueLines(pageCandidates.map((candidate) => candidate.text)),
    engine: "local_pdf",
    confidence: average(
      pageCandidates
        .map((candidate) => candidate.confidence)
        .filter(
          (value): value is number =>
            typeof value === "number" && Number.isFinite(value),
        ),
    ),
    pageCount: pageCandidates.length,
  };
}

export async function extractTextFromDocument(
  filePath: string,
  mimeType: string,
  options: OcrExtractionOptions = {},
): Promise<OcrExtractionResult> {
  const warnings: string[] = [];
  const lowerMime = mimeType.toLowerCase();

  if (lowerMime === "text/plain") {
    const text = await fs.readFile(filePath, "utf8");
    return { text: normalizeText(text), engine: "plain", warnings };
  }

  if (isPdfMime(lowerMime)) {
    const pdfToText = await runCommand(
      "pdftotext",
      ["-layout", "-q", filePath, "-"],
      60_000,
    );
    const digitalCandidate =
      pdfToText.ok && normalizeText(pdfToText.stdout)
        ? {
            text: normalizeText(pdfToText.stdout),
            engine: "pdftotext" as const,
            warnings,
            pageCount: undefined,
          }
        : null;

    if (digitalCandidate && hasUsefulDigitalPdfText(digitalCandidate.text)) {
      return digitalCandidate;
    }

    if (!pdfToText.ok) {
      warnings.push(
        pdfToText.notFound
          ? "pdftotext command is not available on server."
          : `pdftotext failed with code ${String(pdfToText.code)}.`,
      );
    } else if (digitalCandidate?.text) {
      warnings.push(
        "Digital PDF text looked incomplete; local scanned-page OCR was attempted.",
      );
    }

    const rasterOcr = await extractWithPdfRasterOcr(
      filePath,
      warnings,
      options.maxPdfPages ?? 5,
    );
    if (rasterOcr?.text) {
      return {
        text: rasterOcr.text,
        engine: rasterOcr.engine,
        warnings,
        confidence: rasterOcr.confidence,
        pageCount: rasterOcr.pageCount,
      };
    }

    if (digitalCandidate?.text) return digitalCandidate;
    return { text: "", engine: "none", warnings };
  }

  const localImage = await extractWithLocalImageOcr(
    filePath,
    mimeType,
    warnings,
  );
  if (localImage?.text) {
    return {
      text: localImage.text,
      engine: localImage.engine,
      warnings,
      confidence: localImage.confidence,
      pageCount: localImage.pageCount,
    };
  }

  if (!env.OCR_LOCAL_ENABLED)
    warnings.push("Local OCR is disabled by OCR_LOCAL_ENABLED=false.");
  return { text: "", engine: "none", warnings };
}

function parseDecimal(value: string): number {
  const parsed = Number(value.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreProductMatch(
  rawLine: string,
  productNameGuess: string,
  candidate: OcrProductCandidate,
): number {
  const line = normalizeForSearch(rawLine);
  const guess = normalizeForSearch(productNameGuess);
  const name = normalizeForSearch(candidate.name);
  const reference = normalizeForSearch(candidate.reference ?? "");
  const barcode = normalizeForSearch(candidate.barcode ?? "");

  let score = 0;
  if (reference && line.includes(reference)) score += 1.2;
  if (barcode && line.includes(barcode)) score += 1.2;
  if (name && line.includes(name)) score += 1.0;
  if (guess && name && (guess.includes(name) || name.includes(guess)))
    score += 0.8;

  const tokens = guess.split(" ").filter((token) => token.length >= 3);
  if (tokens.length > 0) {
    const hits = tokens.filter((token) => name.includes(token)).length;
    score += (hits / tokens.length) * 0.6;
  }

  return score;
}

function extractHeader(text: string): ReceptionOcrSuggestion["header"] {
  const header: ReceptionOcrSuggestion["header"] = {};
  const compact = text.slice(0, 6000);

  const numberPatterns = [
    /(?:bon(?:[^\S\r\n]+de)?[^\S\r\n]+reception|bon|br|bl|document|piece|facture)[^\S\r\n]*(?:n(?:umero|o)?|n°|°|#)[^\S\r\n]*[:#-]?[^\S\r\n]*([A-Z0-9][A-Z0-9/_-]{3,39})/i,
    /(?:bon(?:[^\S\r\n]+de)?[^\S\r\n]+reception|bon|br|bl|document|piece|facture)[^\S\r\n]*[:#-][^\S\r\n]*([A-Z0-9][A-Z0-9/_-]{3,39})/i,
  ];
  const numberMatch = numberPatterns
    .map((pattern) => compact.match(pattern))
    .find(Boolean);
  const number = numberMatch?.[1];
  if (number) header.number = number;

  const dateFr = compact.match(
    /\b([0-3]?\d)[\/.-]([01]?\d)[\/.-]((?:20)?\d{2})\b/,
  );
  if (dateFr) {
    const dayRaw = dateFr[1] ?? "";
    const monthRaw = dateFr[2] ?? "";
    const yearRaw = dateFr[3] ?? "";
    if (dayRaw && monthRaw && yearRaw) {
      const day = dayRaw.padStart(2, "0");
      const month = monthRaw.padStart(2, "0");
      const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
      header.receptionDate = `${year}-${month}-${day}`;
    }
  } else {
    const dateIso = compact.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (dateIso?.[0]) header.receptionDate = dateIso[0];
  }

  const supplierMatch = compact.match(
    /(?:fournisseur|supplier|vendor)\s*[:\-]\s*([^\n\r]{2,100})/i,
  );
  const supplierName = supplierMatch?.[1]?.trim();
  if (supplierName) header.supplierName = supplierName;

  return header;
}

function stripMarkdownCell(value: string): string {
  return value
    .replace(/[*_`]/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isMarkdownSeparator(cells: string[]): boolean {
  return (
    cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.trim()))
  );
}

function parseTableNumberCell(cell: string): number | null {
  const compact = cell
    .replace(/\b(?:tnd|dt|eur|usd|ht|ttc)\b/gi, "")
    .replace(/[€$]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!compact) return null;
  if (/[a-z]/i.test(compact)) return null;
  if (!/^-?\d+(?:[.,]\d+)?%?$/.test(compact)) return null;
  const digitCount = (compact.match(/\d/g) ?? []).length;
  if (digitCount > 8 && !/[,.%]/.test(compact)) return null;
  const parsed = parseDecimal(compact.replace("%", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line.includes("|")) continue;

    const cells = line.split("|").map(stripMarkdownCell).filter(Boolean);
    if (cells.length < 3 || isMarkdownSeparator(cells)) continue;
    if (
      cells.some((cell) =>
        /^(designation|article|produit|qty|qte|quantite|prix|total|tva)$/i.test(
          cell,
        ),
      )
    )
      continue;

    const numericCells = cells
      .map((cell, index) => ({
        index,
        value: parseTableNumberCell(cell),
      }))
      .filter(
        (cell): cell is { index: number; value: number } =>
          typeof cell.value === "number",
      );
    if (numericCells.length < 2) continue;

    const firstNumericIndex = numericCells[0]?.index ?? -1;
    const nameCells = cells
      .slice(0, firstNumericIndex)
      .filter((cell) => /[a-zA-Z]/.test(cell));
    const productName = nameCells.join(" ").trim();
    if (productName.length < 2) continue;

    const quantity = numericCells[0]?.value ?? 0;
    const unitPrice = numericCells[1]?.value ?? 0;
    const vatCell = cells.find((cell) => /\d+(?:[.,]\d+)?\s*%/.test(cell));
    const vatRate = vatCell
      ? Math.min(
          100,
          Math.max(0, parseDecimal(vatCell.replace(/[^\d,.-]/g, ""))),
        )
      : 19;

    out.push({
      rawText: cells.join(" | "),
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
    .replace(/\b(?:tnd|dt|eur|usd|ht|ttc)\b/gi, " ")
    .replace(/[€$]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tailMatch = withoutCurrency.match(
    /^(.+?)\s+(\d+(?:[.,]\d{1,3})?)\s+(\d+(?:[.,]\d{1,3})?)(?:\s+\d+(?:[.,]\d{1,3})?)?\s*$/,
  );
  if (!tailMatch?.[1] || !tailMatch[2] || !tailMatch[3]) return null;

  const productName = tailMatch[1].trim();
  if (productName.length < 2 || !/[a-zA-Z]/.test(productName)) return null;

  const quantity = parseDecimal(tailMatch[2]);
  const unitPrice = parseDecimal(tailMatch[3]);
  if (
    quantity <= 0 ||
    quantity > 100000 ||
    unitPrice < 0 ||
    unitPrice > 1000000
  )
    return null;

  const vatMatch = line.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const vatRate = vatMatch?.[1]
    ? Math.min(100, Math.max(0, parseDecimal(vatMatch[1])))
    : 19;

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
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
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

export function parseReceptionOcr(
  text: string,
  products: OcrProductCandidate[],
): ReceptionOcrSuggestion {
  const header = extractHeader(text);
  const lineCandidates = extractLineCandidates(text);
  const suggestions: OcrSuggestedLine[] = [];
  const seen = new Set<string>();

  for (const line of lineCandidates) {
    let bestProduct: OcrProductCandidate | null = null;
    let bestScore = 0;

    for (const candidate of products) {
      const score = scoreProductMatch(
        line.rawText,
        line.productName,
        candidate,
      );
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
      productId: bestScore >= 0.8 ? (bestProduct?.id ?? null) : null,
      quantity: line.quantity,
      unitPriceHt: line.unitPriceHt,
      vatRate: line.vatRate,
      confidence: Math.min(1, bestScore / 2),
    });
  }

  return { header, lines: suggestions.slice(0, 30) };
}

export function buildReceptionOcrReview(
  suggestion: ReceptionOcrSuggestion,
  duplicateCandidates: OcrDuplicateCandidate[] = [],
  minimumConfidence = OCR_LINE_CONFIDENCE_REVIEW_THRESHOLD,
): OcrReviewSummary {
  const lowConfidenceLineIndexes: number[] = [];
  const unmatchedLineIndexes: number[] = [];

  suggestion.lines.forEach((line, index) => {
    if (!line.productId) {
      unmatchedLineIndexes.push(index);
    } else if (line.confidence < minimumConfidence) {
      lowConfidenceLineIndexes.push(index);
    }
  });

  const reasons: string[] = [];
  if (unmatchedLineIndexes.length > 0) {
    reasons.push(
      `${unmatchedLineIndexes.length} ligne(s) OCR sans produit associe`,
    );
  }
  if (lowConfidenceLineIndexes.length > 0) {
    reasons.push(
      `${lowConfidenceLineIndexes.length} ligne(s) OCR avec confiance faible`,
    );
  }
  if (duplicateCandidates.length > 0) {
    reasons.push(
      `${duplicateCandidates.length} bon(s) similaires deja trouves`,
    );
  }

  return {
    status: reasons.length > 0 ? "needs_review" : "auto_approved",
    minimumConfidence,
    lowConfidenceLineIndexes,
    unmatchedLineIndexes,
    duplicateCandidates,
    reasons,
  };
}
