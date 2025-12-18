// src/lib/redeemCodes.js

function normCode(v) {
  return typeof v === "string" ? v.trim().toUpperCase() : "";
}

// Klíc pro vyhledávání: jen A-Z0-9 (bez pomlcek, mezer, atd.)
function codeKey(v) {
  return normCode(v).replace(/[^A-Z0-9]/g, "");
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
      // Pozn.: expiredAt musí být ve schématu, jinak se v strict režimu neuloží.
      rc.expiredAt = now;
      changed = true;
    }
  }
  return changed;
}

// Najdi aktivní redeem podle code (v rámci jednoho card dokumentu)
// - porovnává se pres codeKey, aby prošel i scan bez pomlcek
export function findActiveRedeemByCode(card, code, now = new Date()) {
  const key = codeKey(code);
  if (!key) return null;
  if (!Array.isArray(card.redeemCodes)) return null;

  return (
    card.redeemCodes.find((rc) => {
      if (!rc) return false;
      if (rc.status !== "active") return false;

      const rcKey = rc.codeKey ? String(rc.codeKey) : codeKey(rc.code);
      if (rcKey !== key) return false;

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

  const normalizedDisplay = normCode(code);
  const key = codeKey(code);

  if (!normalizedDisplay || !key) {
    const err = new Error("Invalid redeem code");
    err.code = "INVALID_REDEEM_CODE";
    throw err;
  }

  card.redeemCodes.push({
    // code = pro display (muže obsahovat pomlcky)
    code: normalizedDisplay,
    // codeKey = pro vyhledávání (bez pomlcek)
    codeKey: key,

    purpose,
    status: "active",
    validTo,
    meta,
    createdAt: now,
    redeemedAt: null,
    expiredAt: null,
  });

  return card;
}

/**
 * Merchant scan helper:
 * - najde kartu podle merchantId + redeemCodes.codeKey (primárne)
 * - fallback pro stará data: redeemCodes.code
 * - validuje active + validTo
 * - provede redeem podle redeemCode.purpose (reward/coupon)
 * - zapíše CardEvent
 */
export async function redeemByCodeForMerchant({
  Card,
  CardEvent,
  merchantId,
  code,
  source = "merchant-scan",
  actorId = merchantId,
}) {
  const input = normCode(code);
  const key = codeKey(code);

  if (!input || !key) {
    return { ok: false, status: 400, error: "code is required" };
  }

  const now = new Date();

  // 1) Najdi kartu (nejdrív pres codeKey, to je robustní vuci pomlckám)
  let card = await Card.findOne({
    merchantId,
    "redeemCodes.codeKey": key,
  });

  // 2) Fallback pro historická data, kde codeKey ješte není uložené
  if (!card) {
    card = await Card.findOne({
      merchantId,
      "redeemCodes.code": input,
    });
  }

  if (!card) {
    return { ok: false, status: 404, error: "Code not found" };
  }

  if (!Array.isArray(card.redeemCodes) || card.redeemCodes.length === 0) {
    return { ok: false, status: 400, error: "No redeem codes available" };
  }

  // Najdi konkrétní redeem záznam v tom card dokumentu
  const idx = card.redeemCodes.findIndex((x) => {
    if (!x) return false;
    if (x.status !== "active") return false;

    const xKey = x.codeKey ? String(x.codeKey) : codeKey(x.code);
    if (xKey !== key) return false;

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
      // Neuložíme zmeny (stav redeemed) — at to nezamkne kód omylem
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
      actor: { type: "merchant", actorId, source },
      payload: { code: input, codeKey: key, purpose: "reward" },
    });

    return { ok: true, status: 200, card, purpose: "reward", code: input };
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
      actor: { type: "merchant", actorId, source },
      payload: { code: input, codeKey: key, purpose: "coupon", meta: redeem.meta ?? null },
    });

    return { ok: true, status: 200, card, purpose: "coupon", code: input };
  }

  return {
    ok: false,
    status: 409,
    error: "Redeem purpose not supported",
    purpose,
    code: input,
  };
}
