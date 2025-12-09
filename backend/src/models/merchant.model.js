// src/models/merchant.model.js
import mongoose from "mongoose";

const merchantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    // treba pozdeji tiers / plány / nastavení
    // plan: { type: String, default: "free" },
  },
  {
    timestamps: true,
  }
);

export const Merchant = mongoose.model("Merchant", merchantSchema);
