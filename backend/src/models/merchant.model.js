// src/models/merchant.model.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const merchantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    template: {
      type: Schema.Types.Mixed, // flexibiln� � mu�eme menit strukturu na FE
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
    // treba pozdeji tiers / pl�ny / nastaven�
    // plan: { type: String, default: "free" },
  },
  {
    timestamps: true,
  }
);

export const Merchant = mongoose.model("Merchant", merchantSchema);
