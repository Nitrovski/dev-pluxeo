// backend/src/models/pushCampaign.model.js
import mongoose from "mongoose";

const PushCampaignSchema = new mongoose.Schema(
  {
    merchantId: { type: String, index: true, required: true },

    name: { type: String, default: "" },
    header: { type: String, required: true },
    body: { type: String, required: true },

    audience: { type: String, default: "all" }, // MVP
    notify: { type: Boolean, default: true },   // TEXT_AND_NOTIFY vs TEXT

    mode: { type: String, default: "manual" },  // manual | scheduled
    runAt: { type: Date, default: null },

    status: { type: String, default: "draft", index: true }, // draft | queued | processing | sent | failed
    lastError: { type: String, default: "" },
  },
  { timestamps: true }
);

export const PushCampaign =
  mongoose.models.PushCampaign || mongoose.model("PushCampaign", PushCampaignSchema);
