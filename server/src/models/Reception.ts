import { Schema, model, type InferSchemaType } from "mongoose";

const receptionLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPriceHt: { type: Number, required: true, min: 0, default: 0 },
    vatRate: { type: Number, required: true, min: 0, max: 100, default: 19 },
    unitPriceTtc: { type: Number, required: true, min: 0, default: 0 },
    totalHt: { type: Number, required: true, min: 0, default: 0 },
    totalTtc: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const receptionOcrSchema = new Schema(
  {
    documentPath: { type: String, trim: true, maxlength: 260, default: null },
    engine: { type: String, trim: true, maxlength: 40, default: null },
    confidence: { type: Number, min: 0, max: 1, default: null },
    pageCount: { type: Number, min: 0, default: null },
    warnings: { type: [String], default: [] },
    rawText: { type: String, maxlength: 150000, default: "" },
    parsed: { type: Schema.Types.Mixed, default: null },
    corrections: { type: Schema.Types.Mixed, default: null },
    reviewStatus: {
      type: String,
      enum: ["auto_approved", "needs_review", "reviewed"],
      default: "auto_approved",
    },
    reviewReasons: { type: [String], default: [] },
    duplicateCandidates: { type: Schema.Types.Mixed, default: [] },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    processedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    processedAt: { type: Date, default: null },
  },
  { _id: false },
);

const receptionSchema = new Schema(
  {
    number: { type: String, required: true, trim: true, maxlength: 80 },
    franchiseId: {
      type: Schema.Types.ObjectId,
      ref: "Franchise",
      required: true,
    },
    supplierId: { type: Schema.Types.ObjectId, ref: "Supplier", default: null },
    receptionDate: { type: Date, default: Date.now },
    totalHt: { type: Number, required: true, min: 0, default: 0 },
    vat: { type: Number, required: true, min: 0, default: 0 },
    totalTtc: { type: Number, required: true, min: 0, default: 0 },
    status: {
      type: String,
      enum: ["draft", "validated", "cancelled"],
      default: "draft",
    },
    sourceDocumentPath: {
      type: String,
      trim: true,
      maxlength: 260,
      default: null,
    },
    note: { type: String, trim: true, maxlength: 2000 },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    validatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    validatedAt: { type: Date, default: null },
    ocrExtraction: { type: receptionOcrSchema, default: null },
    lines: { type: [receptionLineSchema], default: [] },
  },
  { timestamps: true, collection: "receptions" },
);

receptionSchema.index({ number: 1 }, { unique: true });
receptionSchema.index({ franchiseId: 1, status: 1, createdAt: -1 });
receptionSchema.index({ "ocrExtraction.reviewStatus": 1, createdAt: -1 });

export type ReceptionDoc = InferSchemaType<typeof receptionSchema>;
export const Reception = model("Reception", receptionSchema);
