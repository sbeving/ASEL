import { describe, expect, it } from "vitest";
import {
  applyInstallmentWaiverSnapshot,
  normalizeInstallmentSummary,
  referenceIdString,
  validateRenegotiationParts,
} from "./installments.js";

describe("installments route helpers", () => {
  it("normalizes aging totals for the filtered installments dashboard", () => {
    expect(
      normalizeInstallmentSummary({
        totalCount: 7,
        pendingCount: 3,
        pendingAmount: 450,
        lateCount: 2,
        lateAmount: 180,
        paidCount: 2,
        paidAmount: 320,
        receiptCount: 2,
        late0To7Count: 1,
        late0To7Amount: 80,
        late8To30Count: 1,
        late8To30Amount: 100,
      }),
    ).toEqual({
      totalCount: 7,
      pendingCount: 3,
      pendingAmount: 450,
      lateCount: 2,
      lateAmount: 180,
      dueAmount: 630,
      paidCount: 2,
      paidAmount: 320,
      receiptCount: 2,
      collectionRate: 33.68,
      agingBuckets: {
        late0To7: { count: 1, amount: 80 },
        late8To30: { count: 1, amount: 100 },
        late31To60: { count: 0, amount: 0 },
        late60Plus: { count: 0, amount: 0 },
      },
    });
  });

  it("returns a full zero summary when no installment matches filters", () => {
    expect(normalizeInstallmentSummary()).toEqual({
      totalCount: 0,
      pendingCount: 0,
      pendingAmount: 0,
      lateCount: 0,
      lateAmount: 0,
      dueAmount: 0,
      paidCount: 0,
      paidAmount: 0,
      receiptCount: 0,
      collectionRate: 0,
      agingBuckets: {
        late0To7: { count: 0, amount: 0 },
        late8To30: { count: 0, amount: 0 },
        late31To60: { count: 0, amount: 0 },
        late60Plus: { count: 0, amount: 0 },
      },
    });
  });

  it("validates that split renegotiation parts match the original amount", () => {
    expect(
      validateRenegotiationParts(
        [
          { amount: 100.125, dueDate: "2026-05-10T00:00:00.000Z" },
          { amount: 149.875, dueDate: "2026-06-10T00:00:00.000Z" },
        ],
        250,
      ).map((part) => part.amount),
    ).toEqual([100.125, 149.875]);

    expect(() =>
      validateRenegotiationParts(
        [
          { amount: 100, dueDate: "2026-05-10T00:00:00.000Z" },
          { amount: 120, dueDate: "2026-06-10T00:00:00.000Z" },
        ],
        250,
      ),
    ).toThrow("Split parts must match installment amount");
  });

  it("applies partial and full waiver snapshots without over-waiving", () => {
    expect(applyInstallmentWaiverSnapshot(250, 10, 50)).toEqual({
      amount: 200,
      waivedAmount: 60,
      status: undefined,
    });

    expect(applyInstallmentWaiverSnapshot(200, 60, 200)).toEqual({
      amount: 0,
      waivedAmount: 260,
      status: "renegotiated",
    });

    expect(() => applyInstallmentWaiverSnapshot(100, 0, 120)).toThrow(
      "Waived amount cannot exceed remaining installment",
    );
  });

  it("keeps the original franchise id when receipt generation populates refs", () => {
    const id = "69eac10306c6a2f723472b82";
    expect(referenceIdString(id)).toBe(id);
    expect(referenceIdString({ _id: id, name: "ASEL Mobile" })).toBe(id);
  });
});
