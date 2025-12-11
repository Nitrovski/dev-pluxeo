import mongoose from "mongoose";

const { Schema } = mongoose;

const CardTemplateSchema = new Schema(
  {
    merchantId: {
      type: String,    // Clerk userId
      required: true,
      unique: true,    // 1 merchant = 1 šablona
      index: true,
    },

    // Texty
    programName: { type: String, default: "" },
    headline: { type: String, default: "" },
    subheadline: { type: String, default: "" },
    customMessage: { type: String, default: "" },
    openingHours: { type: String, default: "" },
    websiteUrl: { type: String, default: "" },

    // Pravidla
    freeStampsToReward: { type: Number, default: 10 },

    // Styl / vzhled
    themeVariant: {
      type: String,
      enum: ["classic", "stamps", "minimal"],
      default: "classic",
    },
    primaryColor: { type: String, default: "#FF9900" },
    secondaryColor: { type: String, default: "#111827" },
    logoUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

export const CardTemplate = mongoose.model("CardTemplate", CardTemplateSchema);
