import mongoose from "mongoose";
const { Schema, model } = mongoose;

const CardEventSchema = new Schema(
  {
    merchantId: { type: String, required: true, index: true },

    // Vazba na kartu
    cardId: { type: Schema.Types.ObjectId, ref: "Card", required: true, index: true },
    walletToken: { type: String, index: true }, // debug / lookup

    // Typ eventu
    type: {
      type: String,
      required: true,
      enum: [
        "CARD_CREATED",
        "STAMP_ADDED",
        "REWARD_REDEEMED",
        "COUPON_REDEEMED",
        "REDEEM_FAILED",
        "CARD_UPDATED",
      ],
      index: true,
    },

    // Pro agregace (rychlé soucty)
    deltaStamps: { type: Number, default: 0 },
    deltaRewards: { type: Number, default: 0 },

    // Card “context” – pro budoucí typy
    cardType: {
      type: String,
      enum: ["stamps", "coupon", "loyalty", "business"],
      default: "stamps",
      index: true,
    },
    templateId: { type: String, default: null, index: true },

    // Kdo to udelal (do budoucna staff úcty / zarízení)
    actor: {
      type: {
        type: String,
        enum: ["merchant", "staff", "system"],
        default: "merchant",
      },
      actorId: { type: String, default: null }, // napr. clerk userId staff
      source: { type: String, default: "merchant-app" }, // "scan", "admin", "api"
    },

    // Flexibilní data pro budoucnost (napr. QR payload, coupon code, device info...)
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Indexy pro dashboard (cas + merchant + typ)
CardEventSchema.index({ merchantId: 1, createdAt: -1 });
CardEventSchema.index({ merchantId: 1, type: 1, createdAt: -1 });

export const CardEvent = model("CardEvent", CardEventSchema);
