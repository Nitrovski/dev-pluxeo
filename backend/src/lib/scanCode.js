import crypto from "crypto";

export function generateScanCode() {
  return crypto.randomBytes(9).toString("base64url");
}

export async function ensureCardHasScanCode(card) {
  if (!card || card.scanCode) return card;

  card.scanCode = generateScanCode();
  await card.save();
  return card;
}
