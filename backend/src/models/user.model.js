import mongoose from "mongoose";
const { Schema, model } = mongoose;

const UserSchema = new Schema(
  {
    clerkUserId: { type: String, required: true, unique: true },
    customerId: { type: String, required: true }, // kavárna / merchant
  },
  { timestamps: true }
);

export const User = model("User", UserSchema);
