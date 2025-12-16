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

    // ? jediný prepínac programu
    programType: {
      type: String,
      enum: ["stamps", "coupon", "info"],
      default: "stamps",
      index: true,
    },

    /**
     * Texty / obsah karty (globální)
     */
    programName: { type: String, default: "" },
    headline: { type: String, default: "" },
    subheadline: { type: String, default: "" },
    customMessage: { type: String, default: "" },
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

      // ? kupon text jako “rule”
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

      // zatím mužeš nechat do budoucna (nevadí)
      couponValue: { type: Number },
      couponType: { type: String, enum: ["percentage", "fixed"] },
      couponExpiresInDays: { type: Number },
    },

    /**
     * Styl / vzhled (zustává jen barvy + logo)
     */
    primaryColor: { type: String, default: "#FF9900" },
    secondaryColor: { type: String, default: "#111827" },
    logoUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

CardTemplateSchema.index({ merchantId: 1 }, { unique: true });

export const CardTemplate = mongoose.model("CardTemplate", CardTemplateSchema);
