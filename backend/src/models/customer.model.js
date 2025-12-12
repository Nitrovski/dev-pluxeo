import mongoose from "mongoose";

const { Schema, model } = mongoose;

const CustomerSettingsSchema = new Schema(
  {
    freeStampsToReward: {
      type: Number,
      default: 10,
    },

    // pokud chceš držet "single theme color" kvuli kompatibilite, nech tu
    themeColor: {
      type: String,
      default: "#FF9900",
    },

    logoUrl: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

const CardContentSchema = new Schema(
  {
    headline: { type: String, default: "" },
    subheadline: { type: String, default: "" },
    openingHours: { type: String, default: "" },
    customMessage: { type: String, default: "" },
    websiteUrl: { type: String, default: "" },

    lastUpdatedAt: { type: Date, default: null },

    // design (tady je zdroj pravdy pro “template”)
    themeVariant: {
      type: String,
      enum: ["classic", "stamps", "minimal"],
      default: "classic",
    },
    primaryColor: { type: String, default: "#FF9900" },
    secondaryColor: { type: String, default: "#111111" },
  },
  { _id: false }
);

const CustomerSchema = new Schema(
  {
    // Clerk userId (merchant)
    merchantId: {
      type: String,
      required: true,
      index: true,
    },

    phone: { type: String },
    ico: { type: String },

    // verejné ID (slug), co je v QR / URL
    customerId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    name: { type: String, required: true },
    email: { type: String, default: null },
    address: { type: String, default: null },
    onboardingCompleted: { type: Boolean, default: false },
    settings: {
      type: CustomerSettingsSchema,
      default: () => ({}),
    },

    cardContent: {
      type: CardContentSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

export const Customer = model("Customer", CustomerSchema);
