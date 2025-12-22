import mongoose from "mongoose";

const { Schema } = mongoose;

const CardTemplateSchema = new Schema(
  {
    merchantId: {
      type: String,
      required: true,
      index: true,
      unique: true,
    },

    // ? jedin prepnac programu
    programType: {
      type: String,
      enum: ["stamps", "coupon", "info"],
      default: "stamps",
      index: true,
    },

    /**
     * Texty / obsah karty (globln)
     */
    programName: { type: String, default: "" },
    headline: { type: String, default: "" },
    subheadline: { type: String, default: "" },
    customMessage: { type: String, default: "" },
    promoText: { type: String, default: "" },
    openingHours: { type: String, default: "" },
    websiteUrl: { type: String, default: "" },

    /**
     * Pravidla programu
     */
    rules: {
      freeStampsToReward: {
        type: Number,
        default: 10,
        min: 1,
        max: 100,
        validate: {
          validator: Number.isInteger,
          message: "freeStampsToReward must be an integer",
        },
      },

      // ? kupon text jako rule
      couponText: { type: String, default: "" },

      redeemFormat: {
        type: String,
        enum: ["qr", "barcode"],
        default: "qr",
      },

      barcodeType: {
        type: String,
        enum: ["code128", "ean13"],
        default: "code128",
      },

      // zatm mue nechat do budoucna (nevad)
      couponValue: { type: Number },
      couponType: { type: String, enum: ["percentage", "fixed"] },
      couponExpiresInDays: { type: Number },
    },

    /**
     * Styl / vzhled (zustv jen barvy + logo)
     */
    primaryColor: { type: String, default: "#FF9900" },
    secondaryColor: { type: String, default: "#111827" },
    logoUrl: { type: String, default: "" },

    wallet: {
      google: {
        enabled: { type: Boolean, default: false },
        passType: {
          type: String,
          enum: ["loyalty", "generic"],
          default: "loyalty",
        },
        issuerName: { type: String, default: "" },
        programName: { type: String, default: "" },
        logoUrl: { type: String, default: "" },
        backgroundColor: { type: String, default: "" },
        heroImageUrl: { type: String, default: "" },
        genericConfig: {
          enabled: { type: Boolean, default: false },
          showStampsModule: { type: Boolean, default: true },
          showPromo: { type: Boolean, default: true },
          showWebsite: { type: Boolean, default: false },
          showOpeningHours: { type: Boolean, default: false },
          showEmail: { type: Boolean, default: false },
          showTier: { type: Boolean, default: false },
        },
        links: [
          {
            uri: { type: String, default: "" },
            description: { type: String, default: "" },
          },
        ],
        textModules: [
          {
            header: { type: String, default: "" },
            body: { type: String, default: "" },
          },
        ],
      },
    },
  },
  { timestamps: true }
);

CardTemplateSchema.index({ merchantId: 1 }, { unique: true });

export const CardTemplate = mongoose.model("CardTemplate", CardTemplateSchema);
