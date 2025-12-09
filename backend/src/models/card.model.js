import mongoose from "mongoose";

const { Schema, model } = mongoose;

const CardSchema = new Schema(
  {
    // Verejné ID zákazníka (kavárny apod.), které máme už ted v requestu
    customerId: {
      type: String,
      required: true,
      index: true,
    },

    // Token z Apple/Google Wallet (nebo náš vlastní unikátní identifikátor)
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

    // Pocet již uplatnených odmen (napr. kolik „free coffee“ už probehlo)
    rewards: {
      type: Number,
      default: 0,
    },

    // Libovolná poznámka (už ji máš v DB)
    notes: {
      type: String,
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

export const Card = model("Card", CardSchema);
