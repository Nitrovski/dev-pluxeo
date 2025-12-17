import mongoose from "mongoose";

const { Schema, model } = mongoose;

const RedeemCodeSchema = new Schema(
  {
    // plaintext kód (scan-friendly)
    code: { type: String, required: true },

    // reward = odmena za razítka, coupon = slevový kupon
    purpose: {
      type: String,
      enum: ["reward", "coupon"],
      default: "reward",
      index: true,
    },

    // active = ceká na uplatnení, redeemed = použito, expired = neplatné
    status: {
      type: String,
      enum: ["active", "redeemed", "expired"],
      default: "active",
      index: true,
    },

    // volitelná expirace (hlavne pro coupon)
    validTo: { type: Date, default: null },

    // volitelne metadata (napr. couponId, sleva, campaign…)
    meta: { type: Schema.Types.Mixed, default: null },

    createdAt: { type: Date, default: Date.now },
    redeemedAt: { type: Date, required: false },
  },
  { _id: false }
);


const ShareCardSchema = new Schema(
  {
    // verejný share kód (random, scan-friendly)
    code: { type: String, default: null, index: true },

    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
    },

    rotatedAt: { type: Date, default: null },
  },
  { _id: false }
);


const CardSchema = new Schema(
  {
    merchantId: {
      type: String,
      ref: "Merchant",
      required: true,
      index: true,
    },

    clientId: { type: String, index: true },

    customerId: {
      type: String,
      required: false,
      index: true,
    },
    
    share: {
       type: ShareCardSchema,
       default: () => ({}),
    },

    walletToken: {
      type: String,
      required: true,
      unique: true,
    },

    // (zatím necháváme — pozdeji mužeme odstranit, protože program je globální)
    templateId: {
      type: Schema.Types.ObjectId,
      ref: "CardTemplate",
      required: false,
      index: true,
    },

    // (zatím necháváme — pozdeji mužeme odstranit, protože threshold bude z CardTemplate)
    stampsPerReward: {
      type: Number,
      default: 10,
      min: 1,
    },

    lastEventAt: {
      type: Date,
      required: false,
      index: true,
    },

    stamps: {
      type: Number,
      default: 0,
      min: 0,
    },

    rewards: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ? NOVÉ: seznam redeem kódu (plaintext), pro uplatnení odmen
    redeemCodes: {
      type: [RedeemCodeSchema],
      default: [],
    },

    notes: {
      type: String,
    },

    type: {
      type: String,
      default: "stamps",
    },
  },
  { timestamps: true }
);

// dedupe index
CardSchema.index(
  { merchantId: 1, clientId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      clientId: { $type: "string" },
    },
  }
);

// (volitelné, ale doporucené) aby nebyly duplicity redeem kódu v jedné karte
CardSchema.index(
  { merchantId: 1, "redeemCodes.code": 1 },
  { unique: true, partialFilterExpression: { "redeemCodes.code": { $type: "string" } } }
);

export const Card = model("Card", CardSchema);
