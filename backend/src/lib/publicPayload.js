import { Card } from "../models/card.model.js";

export async function buildPublicCardPayload(cardId) {
  const card = await Card.findById(cardId).lean();
  if (!card) return null;

  const active = (card.redeemCodes || []).filter((x) => x.status === "active");

  const pick =
    active.find((x) => x.purpose === "reward") ||
    active.find((x) => x.purpose === "coupon") ||
    null;

  return {
    cardId: String(card._id),
    customerId: card.customerId,
    stamps: card.stamps,
    rewards: card.rewards,
    redeemCode: pick
      ? { code: pick.code, purpose: pick.purpose, validTo: pick.validTo ?? null }
      : null,
  };
}
