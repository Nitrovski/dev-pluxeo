import mongoose from "mongoose";

const { Schema, model } = mongoose;

const CardSchema = new Schema(
  {
    // ID merchanta, kterému karta patrí
    merchantId: {
      type: String,
      ref: "Merchant",
      required: true,
      index: true,
    },
    
    clientId: { type: String, index: true },

    // Verejné ID zákazníka (kavárny apod.)
    customerId: {
      type: String,
      required: false,
      index: true,
    },

    // Token z Apple/Google Wallet nebo náš unikátní identifikátor
    walletToken: {
      type: String,
      required: true,
      unique: true,
    },

    // Pocet nasbíraných razítek
    stamps: {
      type: Number,
      default: 0,
    },

    // Pocet již uplatnených odmen
    rewards: {
      type: Number,
      default: 0,
    },

    // Poznámka
    notes: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// ? Unikátní dedupe index
CardSchema.index(
  { merchantId: 1, clientId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      clientId: { $type: "string" },
    },
  }
);

export const Card = model("Card", CardSchema);
