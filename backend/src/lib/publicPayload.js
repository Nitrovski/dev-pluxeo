import { Card } from "../models/card.model.js";

export async function buildPublicCardPayload(cardId) {
  const card = await Card.findById(cardId).lean();
  if (!card) return null;

  const redeemCodes = Array.isArray(card.redeemCodes)
    ? card.redeemCodes.filter(Boolean)
    : [];

  const active = redeemCodes.filter(
    (x) => x && x.status === "active"
  );

  const pick =
    active.find((x) => x.purpose === "reward") ||
    active.find((x) => x.purpose === "coupon") ||
    null;

  return {
    cardId: String(card._id),
    customerId: card.customerId ?? null,
    stamps: Number(card.stamps || 0),
    rewards: Number(card.rewards || 0),

    redeemCode: pick
      ? {
          code: String(pick.code || ""),
          purpose: pick.purpose || "reward",
          validTo: pick.validTo ? new Date(pick.validTo).toISOString() : null,
          meta: pick.meta ?? null,
        }
      : null,
  };
}
