import { describe, expect, it } from "vitest";
import { evaluateSaleDiscountPolicy } from "./sales.js";

describe("sales route helpers", () => {
  it("allows cashier discounts inside the standard threshold", () => {
    expect(
      evaluateSaleDiscountPolicy({
        lines: [
          { lineSubtotal: 100, discount: 5 },
          { lineSubtotal: 200, discount: 10 },
        ],
        globalDiscount: 15,
        canOverride: false,
      }),
    ).toMatchObject({
      subtotal: 300,
      lineDiscountTotal: 15,
      totalDiscount: 30,
      requiresApproval: false,
    });
  });

  it("requires override permission and reason above discount thresholds", () => {
    expect(() =>
      evaluateSaleDiscountPolicy({
        lines: [{ lineSubtotal: 100, discount: 8 }],
        globalDiscount: 0,
        canOverride: false,
      }),
    ).toThrow("Discount exceeds cashier threshold");

    expect(() =>
      evaluateSaleDiscountPolicy({
        lines: [{ lineSubtotal: 100, discount: 8 }],
        globalDiscount: 0,
        canOverride: true,
      }),
    ).toThrow("Discount approval reason is required");

    expect(
      evaluateSaleDiscountPolicy({
        lines: [{ lineSubtotal: 100, discount: 8 }],
        globalDiscount: 0,
        canOverride: true,
        approvalReason: "Accord responsable",
      }),
    ).toMatchObject({
      requiresApproval: true,
      violations: ["line 1: 8"],
    });
  });
});
