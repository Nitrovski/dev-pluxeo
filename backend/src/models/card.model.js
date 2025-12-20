import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * Redeem code subdocument
 * - udržujeme historii: active -> redeemed/expired
 */
const RedeemCodeSchema = new Schema(
  {
    // plaintext kód (scan-friendly)
    code: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // normalizovaný klíc pro scan (bez pomlcek)
    codeKey: {
      type: String,
      required: true,
      index: true,
    },

    // reward = odmena za razítka, coupon = slevový kupon
    purpose: {
      type: String,
      enum: ["reward", "coupon"],
      required: true,
      default: "reward",
      index: true,
    },

    // active = ceká na uplatnení, redeemed = použito, expired = neplatné
    status: {
      type: String,
      enum: ["active", "redeemed", "expired"],
      required: true,
      default: "active",
      index: true,
    },

    // volitelná expirace (hlavne pro coupon)
    validTo: { type: Date, default: null },

    // audit
    createdAt: { type: Date, default: Date.now },
    redeemedAt: { type: Date, default: null },
    expiredAt: { type: Date, default: null },

    // volitelné metadata
    meta: { type: Schema.Types.Mixed, default: null },
  },
  {
    _id: false,
    timestamps: true, // ?? KLÍCOVÉ
  }
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

    googleWallet: {
      type: new Schema(
        {
          objectId: { type: String, default: null },
        },
        { _id: false }
      ),
      default: {},
    },

    // dedupe pro enroll (FE posílá clientId)
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
      index: true,
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

    // seznam redeem kódu (plaintext), pro uplatnení odmen / couponu
    // držíme historii, ale public payload vybírá jen 1 aktivní dle priority
    redeemCodes: {
      type: [RedeemCodeSchema],
      default: [],
    },

    notes: {
      type: String,
      default: "",
    },

    // typ programu (zatím)
    type: {
      type: String,
      default: "stamps",
      index: true,
    },
  },
  { timestamps: true }
);

/**
 * Dedupe index pro enroll: merchantId + clientId musí být unikátní, pokud clientId existuje
 */
CardSchema.index(
  { merchantId: 1, clientId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      clientId: { $type: "string" },
    },
  }
);

/**
 * Scan lookup index: merchantId + redeemCodes.code (NE-unique)
 * - potrebujeme rychle najít kartu podle redeem kódu
 * - unikátnost kódu rešíme generátorem (a prípadne pozdeji globálním unique)
 */
CardSchema.index(
  { merchantId: 1, "redeemCodes.code": 1 }
);

export const Card = model("Card", CardSchema);
