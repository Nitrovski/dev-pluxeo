import mongoose from "mongoose";

const { Schema } = mongoose;

const GenericLayoutSlotSchema = new Schema(
  {
    fieldId: { type: String, default: null },
    label: { type: String, default: null },
  },
  { _id: false }
);

const GenericLayoutRowSchema = new Schema(
  {
    type: { type: String, enum: ["two", "one"], default: "two" },
    left: { type: GenericLayoutSlotSchema, default: null },
    right: { type: GenericLayoutSlotSchema, default: null },
    value: { type: GenericLayoutSlotSchema, default: null },
  },
  { _id: false }
);

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
      enum: ["custom", "stamps", "coupon", "info"],
      default: "custom",
      index: true,
    },
    // novější alias pro programType (FE očekává cardType)
    cardType: {
      type: String,
      enum: ["custom", "stamps", "coupon", "info"],
      default: "custom",
    },

    // nový top-level práh (fallback na rules.freeStampsToReward)
    freeStampsToReward: {
      type: Number,
      default: 10,
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "freeStampsToReward must be an integer",
      },
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
    detailsText: { type: String, default: null, trim: true, maxlength: 1500 },
    termsText: { type: String, default: null, trim: true, maxlength: 1500 },

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
        headerText: { type: String, default: null },
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
          barcode: {
            enabled: { type: Boolean, default: true },
            type: { type: String, default: "QR_CODE" },
          },
          layout: {
            cardRows: {
              type: [GenericLayoutRowSchema],
              default: [
                { type: "two", left: null, right: null },
                { type: "two", left: null, right: null },
                { type: "one", value: null },
              ],
            },
          },
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
    walletSync: {
      google: {
        generic: {
          pendingPatchAt: { type: Date, default: null },
          lastPatchedAt: { type: Date, default: null },
        },
      },
    },
  },
  { timestamps: true }
);

CardTemplateSchema.index({ merchantId: 1 }, { unique: true });

export const CardTemplate = mongoose.model("CardTemplate", CardTemplateSchema);
