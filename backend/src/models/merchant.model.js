// src/models/merchant.model.js
import mongoose from "mongoose";

const merchantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    template: {
      type: Schema.Types.Mixed, // flexibilní – mužeme menit strukturu na FE
      default: {},
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
