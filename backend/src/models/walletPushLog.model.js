import mongoose from "mongoose";

const WalletPushLogSchema = new mongoose.Schema(
  {
    merchantId: { type: String, index: true, required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, index: true, required: false },

    cardId: { type: mongoose.Schema.Types.ObjectId, index: true, required: true },
    objectId: { type: String, index: true, required: true },

    kind: { type: String, index: true, default: "campaign" }, // campaign / reward / promo
    notify: { type: Boolean, default: true },
    dedupeKey: { type: String, index: true, default: "" },

    status: { type: String, index: true, default: "sent" }, // sent | skipped | failed
    error: { type: String, default: "" },
  },
  { timestamps: true }
);

export const WalletPushLog =
  mongoose.models.WalletPushLog || mongoose.model("WalletPushLog", WalletPushLogSchema);
