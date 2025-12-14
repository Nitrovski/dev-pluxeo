import mongoose from "mongoose";

const { Schema, model } = mongoose;

// Enrollment (statický QR kód obchodníka)
const EnrollmentSchema = new Schema(
  {
    code: {
      type: String,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
    },
    rotatedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const CustomerSettingsSchema = new Schema(
  {
    // (volitelné) pokud chceš držet "single theme color" kvuli kompatibilite, nech tu
    themeColor: {
      type: String,
      default: "#FF9900",
    },

    logoUrl: {
      type: String,
      default: null,
    },

    // enrollment info pro statický QR
    enrollment: {
      type: EnrollmentSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

/**
 * CardContent = OVERRIDE obsahu/vzhledu pro konkrétního zákazníka (pokud se používá)
 * Zdroj pravdy pro "template/program" je CardTemplate (globální pro merchanta).
 */
const CardContentSchema = new Schema(
  {
    headline: { type: String, default: "" },
    subheadline: { type: String, default: "" },
    openingHours: { type: String, default: "" },
    customMessage: { type: String, default: "" },
    websiteUrl: { type: String, default: "" },

    lastUpdatedAt: { type: Date, default: null },

    // design override (ne template)
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
      unique: true, // pokud chceš unikátní globálne napríc celým systémem, nech to
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

// ? volitelné do budoucna (NEZAPÍNÁM ti to automaticky):
// Pokud bys chtel, aby customerId (slug) mohl být stejný u ruzných merchantu,
// tak zruš unique:true na customerId a použij tento index:
// CustomerSchema.index({ merchantId: 1, customerId: 1 }, { unique: true });

export const Customer = model("Customer", CustomerSchema);
