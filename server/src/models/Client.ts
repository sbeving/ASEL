import { Schema, model, type InferSchemaType } from "mongoose";

const clientSchema = new Schema(
  {
    firstName: { type: String, trim: true, maxlength: 100, default: "" },
    lastName: { type: String, trim: true, maxlength: 100, default: "" },
    fullName: { type: String, required: true, trim: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 40 },
    phone2: { type: String, trim: true, maxlength: 40 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },
    address: { type: String, trim: true, maxlength: 300 },
    clientType: {
      type: String,
      enum: ["walkin", "boutique", "wholesale", "passager", "other"],
      default: "walkin",
    },
    company: { type: String, trim: true, maxlength: 160 },
    taxId: { type: String, trim: true, maxlength: 80 },
    cin: { type: String, trim: true, maxlength: 40 },
    creditProfile: {
      monthlySalary: { type: Number, min: 0, default: null },
      additionalIncome: { type: Number, min: 0, default: null },
      employmentStatus: {
        type: String,
        enum: [
          "unknown",
          "salaried",
          "self_employed",
          "business_owner",
          "unemployed",
          "retired",
          "student",
          "other",
        ],
        default: "unknown",
      },
      employer: { type: String, trim: true, maxlength: 160 },
      jobTitle: { type: String, trim: true, maxlength: 120 },
      housingStatus: {
        type: String,
        enum: ["unknown", "owner", "family", "rent", "mortgage", "other"],
        default: "unknown",
      },
      monthlyRent: { type: Number, min: 0, default: null },
      maritalStatus: {
        type: String,
        enum: ["unknown", "single", "married", "divorced", "widowed", "other"],
        default: "unknown",
      },
      childrenCount: { type: Number, min: 0, max: 20, default: 0 },
      spouseWorks: { type: Boolean, default: null },
      distanceKmToFranchise: { type: Number, min: 0, default: null },
      creditNotes: { type: String, trim: true, maxlength: 1500 },
    },
    creditScoreHistory: [
      {
        capturedAt: { type: Date, default: Date.now },
        capturedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
        source: {
          type: String,
          enum: ["create", "manual_update", "sale_guard", "system"],
          default: "system",
        },
        score: { type: Number, min: 0, max: 100, required: true },
        tier: {
          type: String,
          enum: ["excellent", "good", "watch", "risky"],
          required: true,
        },
        label: { type: String, trim: true, maxlength: 80 },
        recommendedCreditLimit: { type: Number, min: 0, default: 0 },
        maxMonthlyPayment: { type: Number, min: 0, default: 0 },
        balanceDue: { type: Number, min: 0, default: 0 },
        lateInstallments: { type: Number, min: 0, default: 0 },
        totalSpent: { type: Number, min: 0, default: 0 },
        reasons: { type: [String], default: [] },
      },
    ],
    documents: {
      cinImagePath: { type: String, trim: true, maxlength: 260, default: null },
      payslipPath: { type: String, trim: true, maxlength: 260, default: null },
      proofOfAddressPath: {
        type: String,
        trim: true,
        maxlength: 260,
        default: null,
      },
      signedAgreementPath: {
        type: String,
        trim: true,
        maxlength: 260,
        default: null,
      },
      updatedAt: { type: Date, default: null },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    notes: { type: String, trim: true, maxlength: 1000 },
    franchiseId: {
      type: Schema.Types.ObjectId,
      ref: "Franchise",
      default: null,
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "clients" },
);

clientSchema.index({ fullName: 1 });
clientSchema.index({ phone: 1 });
clientSchema.index({ franchiseId: 1, active: 1 });

export type ClientDoc = InferSchemaType<typeof clientSchema>;
export const Client = model("Client", clientSchema);
