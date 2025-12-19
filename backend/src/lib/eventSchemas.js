export const CARD_EVENT_TYPES = [
  "CARD_CREATED",
  "STAMP_ADDED",
  "REWARD_ISSUED",
  "COUPON_ISSUED",
  "REWARD_REDEEMED",
  "COUPON_REDEEMED",
  "REDEEM_FAILED",
  "CARD_UPDATED",
];

const CARD_TYPES = ["stamps", "coupon", "loyalty", "business"];
const ACTOR_TYPES = ["merchant", "staff", "system"];
const SCAN_STATUSES = ["success", "failure"];

function assertField(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeActor(actor = {}) {
  const type = ACTOR_TYPES.includes(actor.type) ? actor.type : "merchant";
  const actorId = actor.actorId ?? null;
  const source = typeof actor.source === "string" && actor.source ? actor.source : "merchant-app";
  return { type, actorId, source };
}

export function buildCardEventPayload(event) {
  assertField(event && typeof event === "object", "event payload is required");
  const { merchantId, cardId, type } = event;
  assertField(typeof merchantId === "string" && merchantId, "merchantId is required");
  assertField(cardId, "cardId is required");
  assertField(CARD_EVENT_TYPES.includes(type), "type is required");

  const deltaStamps = Number.isFinite(event.deltaStamps) ? event.deltaStamps : 0;
  const deltaRewards = Number.isFinite(event.deltaRewards) ? event.deltaRewards : 0;
  const cardType = CARD_TYPES.includes(event.cardType) ? event.cardType : null;
  const templateId = event.templateId ?? null;
  const walletToken = event.walletToken ?? null;
  const payload = event.payload ?? {};

  return {
    merchantId,
    cardId,
    walletToken,
    type,
    deltaStamps,
    deltaRewards,
    cardType,
    templateId,
    actor: normalizeActor(event.actor),
    payload,
  };
}

export function buildScanEventPayload(event) {
  assertField(event && typeof event === "object", "scan event payload is required");
  const { status } = event;
  assertField(SCAN_STATUSES.includes(status), "status is required");

  const merchantId = event.merchantId ?? null;
  const cardId = event.cardId ?? null;
  const code = event.code ?? null;
  const reason = event.reason ?? null;
  const payload = event.payload ?? {};

  return { merchantId, cardId, code, status, reason, payload };
}
