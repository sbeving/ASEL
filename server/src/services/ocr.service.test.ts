import { describe, expect, it } from "vitest";
import {
  buildReceptionOcrReview,
  parseReceptionOcr,
  type OcrProductCandidate,
} from "./ocr.service.js";

const products: OcrProductCandidate[] = [
  {
    id: "665000000000000000000001",
    name: "ASel Forfait 20Go",
    reference: "FORF-20",
    barcode: "6190001112223",
  },
  {
    id: "665000000000000000000002",
    name: "Carte Recharge 10 TND",
    reference: "RCH-10",
    barcode: "6190001113336",
  },
];

describe("parseReceptionOcr", () => {
  it("extracts invoice header and markdown table lines with product matches", () => {
    const parsed = parseReceptionOcr(
      `
      Fournisseur: Tunisie Telecom Distribution
      Facture N: FAC-2026-0042
      Date: 10/05/2026

      | Designation | Qte | Prix HT | TVA | Total |
      | --- | ---: | ---: | ---: | ---: |
      | FORF-20 ASel Forfait 20Go | 3 | 18,000 | 19% | 54,000 |
      | 6190001113336 Carte Recharge 10 TND | 12 | 9,000 | 19% | 108,000 |
      `,
      products,
    );

    expect(parsed.header).toMatchObject({
      number: "FAC-2026-0042",
      receptionDate: "2026-05-10",
      supplierName: "Tunisie Telecom Distribution",
    });
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]).toMatchObject({
      productId: products[0]!.id,
      quantity: 3,
      unitPriceHt: 18,
      vatRate: 19,
    });
    expect(parsed.lines[1]).toMatchObject({
      productId: products[1]!.id,
      quantity: 12,
      unitPriceHt: 9,
      vatRate: 19,
    });
  });

  it("extracts plain OCR product lines when table structure is lost", () => {
    const parsed = parseReceptionOcr(
      `
      Bon de reception no: BR-0099
      ASel Forfait 20Go FORF-20 5 17.500 87.500
      Carte Recharge 10 TND RCH-10 8 9,000 72,000
      Total TTC 189,805
      `,
      products,
    );

    expect(parsed.header.number).toBe("BR-0099");
    expect(parsed.lines.map((line) => line.productId)).toEqual([
      products[0]!.id,
      products[1]!.id,
    ]);
    expect(parsed.lines.map((line) => line.quantity)).toEqual([5, 8]);
  });

  it("requires review for unmatched, low confidence, and duplicate candidates", () => {
    const review = buildReceptionOcrReview(
      {
        header: {},
        lines: [
          {
            rawText: "FORF-20 2 18",
            productName: "ASel Forfait 20Go",
            productId: products[0]!.id,
            quantity: 2,
            unitPriceHt: 18,
            vatRate: 19,
            confidence: 0.42,
          },
          {
            rawText: "Unknown line 1 10",
            productName: "Unknown line",
            productId: null,
            quantity: 1,
            unitPriceHt: 10,
            vatRate: 19,
            confidence: 0,
          },
        ],
      },
      [
        {
          id: "665000000000000000000099",
          number: "FAC-2026-0042",
          totalTtc: 42,
          status: "draft",
          score: 85,
          reasons: ["same_invoice_number"],
        },
      ],
    );

    expect(review.status).toBe("needs_review");
    expect(review.lowConfidenceLineIndexes).toEqual([0]);
    expect(review.unmatchedLineIndexes).toEqual([1]);
    expect(review.duplicateCandidates).toHaveLength(1);
    expect(review.reasons.join(" ")).toContain("similaires");
  });

  it("auto approves clean OCR matches", () => {
    const review = buildReceptionOcrReview({
      header: {},
      lines: [
        {
          rawText: "FORF-20 2 18",
          productName: "ASel Forfait 20Go",
          productId: products[0]!.id,
          quantity: 2,
          unitPriceHt: 18,
          vatRate: 19,
          confidence: 0.9,
        },
      ],
    });

    expect(review.status).toBe("auto_approved");
    expect(review.reasons).toEqual([]);
  });
});
