import mongoose from "mongoose";

const { Schema, model } = mongoose;

const CustomerSettingsSchema = new Schema(
  {
    freeStampsToReward: {
      type: Number,
      default: 10,
    },
    themeColor: {
      type: String,
      default: "#FF9900",
    },
    logoUrl: {
      type: String,
    },
  },
  { _id: false }
);

// nový blok pro obsah karty
const CardContentSchema = new Schema(
  {
    // hlavní titulek na karte (napr. "Káva zdarma po 10 razítkách")
    headline: {
      type: String,
      default: "",
    },
    // podtitulek / krátký popis
    subheadline: {
      type: String,
      default: "",
    },
    // otevírací doba – pro MVP jako prostý text
    openingHours: {
      type: String,
      default: "",
    },
    // volná promo zpráva – mužeš menit podle potreby
    customMessage: {
      type: String,
      default: "",
    },
    // odkaz na web / menu / rezervace
    websiteUrl: {
      type: String,
      default: "",
    },
    // kdy obchodník naposledy neco zmenil
    lastUpdatedAt: {
      type: Date,
    },
  },
  { _id: false }
);

const CustomerSchema = new Schema(
  {
    customerId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
    },
    address: {
      type: String,
    },

    settings: {
      type: CustomerSettingsSchema,
      default: {},
    },

    // ?? tady pridáme obsah karty
    cardContent: {
      type: CardContentSchema,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

export const Customer = model("Customer", CustomerSchema);
