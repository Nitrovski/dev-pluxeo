// lib/googleWalletIds.js
// Examples:
// makeClassId({ issuerId: "issuer", classPrefix: "loyalty", merchantId: "My Shop#1" }) => "issuer.loyalty_my_shop_1"
// makeObjectId({ issuerId: "issuer", cardId: "Card-123" }) => "issuer.card_card_123"

function normalizeIdPart(value, maxLength = 60) {
  const normalized = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");

  return normalized.slice(0, maxLength);
}

export function makeClassId({ issuerId, classPrefix, merchantId }) {
  const merchantIdNormalized = normalizeIdPart(merchantId);
  return `${issuerId}.${classPrefix}_${merchantIdNormalized}`;
}

export function makeObjectId({ issuerId, cardId }) {
  const cardIdNormalized = normalizeIdPart(cardId);
  return `${issuerId}.card_${cardIdNormalized}`;
}
