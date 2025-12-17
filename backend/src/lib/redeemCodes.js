// src/lib/redeemCodes.js
function normCode(v) {
  return typeof v === "string" ? v.trim().toUpperCase() : "";
}

export function isActiveRedeem(rc, now = new Date()) {
  if (!rc) return false;
  if (rc.status !== "active") return false;
  if (typeof rc.code !== "string" || !rc.code.trim()) return false;
  if (rc.validTo && new Date(rc.validTo) <= now) return false;
  return true;
}

export function getActiveRedeemByPurpose(card, purpose, now = new Date()) {
  if (!Array.isArray(card.redeemCodes)) return null;
  return (
    card.redeemCodes.find((rc) => rc?.purpose === purpose && isActiveRedeem(rc, now)) ||
    null
  );
}

// Priorita pro zobrazení v pass.barcode (PassKit obvykle jen jeden)
export function pickRedeemForDisplay(card, now = new Date()) {
  return (
    getActiveRedeemByPurpose(card, "reward", now) ||
    getActiveRedeemByPurpose(card, "coupon", now) ||
    null
  );
}

export function expireActiveRedeem(card, purpose, now = new Date()) {
  if (!Array.isArray(card.redeemCodes)) return false;
  let changed = false;

  for (const rc of card.redeemCodes) {
    if (rc?.purpose === purpose && isActiveRedeem(rc, now)) {
      rc.status = "expired";
      rc.expiredAt = now; // ? doporuceno pro audit
      changed = true;
    }
  }
  return changed;
}

// najdi aktivní redeem podle code
export function findActiveRedeemByCode(card, code, now = new Date()) {
  const c = normCode(code);
  if (!c) return null;
  if (!Array.isArray(card.redeemCodes)) return null;

  return (
    card.redeemCodes.find((rc) => {
      if (!rc) return false;
      if (rc.status !== "active") return false;
      if (normCode(rc.code) !== c) return false;
      if (rc.validTo && new Date(rc.validTo) <= now) return false;
      return true;
    }) || null
  );
}

/**
 * rotateStrategy:
 * - "reject" -> když existuje active, vrátí error
 * - "expireAndIssue" -> aktivní expirovat a vydat nový
 */
export function issueRedeemCode(
  card,
  { code, purpose, validTo = null, meta = null, rotateStrategy = "expireAndIssue" }
) {
  const now = new Date();
  const active = getActiveRedeemByPurpose(card, purpose, now);

  if (active) {
    if (rotateStrategy === "reject") {
      const err = new Error("Active redeem code already exists");
      err.code = "ACTIVE_REDEEM_EXISTS";
      throw err;
    }
    expireActiveRedeem(card, purpose, now);
  }

  if (!Array.isArray(card.redeemCodes)) card.redeemCodes = [];

  card.redeemCodes.push({
    code: normCode(code),  // ? ukládej normalizovane
    purpose,
    status: "active",
    validTo,
    meta,
    createdAt: now,
  });
    return card;
}
/**
 * Merchant scan helper:
 * - najde kartu podle merchantId + redeemCodes.code
 * - validuje active + validTo
 * - provede redeem podle redeemCode.purpose (reward/coupon)
 * - zapíše CardEvent
 *
 * Pozn.: Je to "DB helper" (delá query), takže sem posíláme Card a CardEvent z routy.
 */
export async function redeemByCodeForMerchant({
  Card,
  CardEvent,
  merchantId,
  code,
  source = "merchant-scan",
  actorId = merchantId,
}) {
  const codeTrim = typeof code === "string" ? code.trim() : "";
  if (!codeTrim) {
    return { ok: false, status: 400, error: "code is required" };
  }

  const now = new Date();

  // Najdi kartu, která obsahuje daný kód (muže být i redeemed – to pak odmítneme níž)
  const card = await Card.findOne({
    merchantId,
    "redeemCodes.code": codeTrim,
  });

  if (!card) {
    return { ok: false, status: 404, error: "Code not found" };
  }

  if (!Array.isArray(card.redeemCodes) || card.redeemCodes.length === 0) {
    return { ok: false, status: 400, error: "No redeem codes available" };
  }

  const idx = card.redeemCodes.findIndex((x) => {
    if (!x) return false;
    if (typeof x.code !== "string") return false;
    if (x.code.trim() !== codeTrim) return false;
    if (x.status !== "active") return false;
    if (x.validTo && new Date(x.validTo) <= now) return false;
    return true;
  });

  if (idx === -1) {
    return {
      ok: false,
      status: 400,
      error: "Invalid, expired, or already redeemed code",
    };
  }

  const redeem = card.redeemCodes[idx];
  const purpose = redeem.purpose || "reward"; // backward compatible

  // spolecné: oznacit kód jako redeemed
  card.redeemCodes[idx].status = "redeemed";
  card.redeemCodes[idx].redeemedAt = now;
  card.lastEventAt = now;

  // ------------------------------------------------------------
  // REWARD
  // ------------------------------------------------------------
  if (purpose === "reward") {
    const currentRewards = card.rewards || 0;
    if (currentRewards < 1) {
      return { ok: false, status: 400, error: "No rewards available" };
    }

    card.rewards = currentRewards - 1;
    await card.save();

    await CardEvent.create({
      merchantId,
      cardId: card._id,
      walletToken: card.walletToken,
      type: "REWARD_REDEEMED",
      deltaStamps: 0,
      deltaRewards: -1,
      cardType: card.type ?? "stamps",
      templateId: card.templateId ?? null,
      actor: {
        type: "merchant",
        actorId,
        source,
      },
      payload: { code: codeTrim, purpose: "reward" },
    });

    return { ok: true, status: 200, card, purpose: "reward" };
  }

  // ------------------------------------------------------------
  // COUPON
  // ------------------------------------------------------------
  if (purpose === "coupon") {
    await card.save();

    await CardEvent.create({
      merchantId,
      cardId: card._id,
      walletToken: card.walletToken,
      type: "COUPON_REDEEMED",
      deltaStamps: 0,
      deltaRewards: 0,
      cardType: card.type ?? "coupon",
      templateId: card.templateId ?? null,
      actor: {
        type: "merchant",
        actorId,
        source,
      },
      payload: { code: codeTrim, purpose: "coupon", meta: redeem.meta ?? null },
    });

    return { ok: true, status: 200, card, purpose: "coupon" };
  }

  return {
    ok: false,
    status: 409,
    error: "Redeem purpose not supported",
    purpose,
  };
}

