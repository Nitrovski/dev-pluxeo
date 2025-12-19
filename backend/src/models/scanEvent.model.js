import mongoose from "mongoose";

const { Schema, model } = mongoose;

const ScanEventSchema = new Schema(
  {
    merchantId: { type: String, default: null, index: true },
    cardId: { type: Schema.Types.ObjectId, ref: "Card", default: null, index: true },
    code: { type: String, default: null },
    status: { type: String, enum: ["success", "failure"], required: true },
    reason: { type: String, default: null },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ScanEventSchema.index({ merchantId: 1, createdAt: -1 });
ScanEventSchema.index({ status: 1, createdAt: -1 });

export const ScanEvent = model("ScanEvent", ScanEventSchema);
