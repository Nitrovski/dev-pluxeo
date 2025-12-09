import mongoose from "mongoose";

const { Schema, model } = mongoose;

const StampLogSchema = new Schema(
  {
    // Na jakou kartu se zmena vztahuje
    cardId: {
      type: Schema.Types.ObjectId,
      ref: "Card",
      required: true,
      index: true,
    },

    // Pro jistotu si pridáme i customerId (rychlé filtrování)
    customerId: {
      type: String,
      required: true,
      index: true,
    },

    // Zmena v poctu razítek, typicky +1, ale muže být i +2, -1 apod.
    change: {
      type: Number,
      required: true,
    },

    // Duvod (napr. „razítko pridáno obsluhou“, „odmena uplatnena“)
    reason: {
      type: String,
    },

    // Kdo to provedl – pozdeji mužeme mít user úcty obsluhy
    createdBy: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

export const StampLog = model("StampLog", StampLogSchema);
