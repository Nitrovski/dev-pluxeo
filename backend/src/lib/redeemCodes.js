// src/lib/redeemCodes.js
import { buildCardEventPayload } from "./eventSchemas.js";
import { ensureCardHasScanCode } from "./scanCode.js";

function normCode(v) {
  return typeof v === "string" ? v.trim().toUpperCase() : "";
}

function normCodeKey(v) {
  return String(v || "")
    .trim()
    .toUpperCase()
    .replace(/^PXR:/, "")
    .replace(/[^A-Z0-9]/g, "");
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
      // Pozn.: expiredAt musí být ve schématu, jinak se v strict reimu neuloí.
      rc.expiredAt = now;
      changed = true;
    }
  }
  return changed;
}

// Najdi aktivní redeem podle code (v rámci jednoho card dokumentu)
// - porovnává se pres codeKey, aby proel i scan bez pomlcek
export function findActiveRedeemByCode(card, code, now = new Date()) {
  const key = normCodeKey(code);
  if (!key) return null;
  if (!Array.isArray(card.redeemCodes)) return null;

  return (
    card.redeemCodes.find((rc) => {
      if (!rc) return false;
      if (rc.status !== "active") return false;

      const rcKey = rc.codeKey ? normCodeKey(rc.codeKey) : normCodeKey(rc.code);
      if (rcKey !== key) return false;

      if (rc.validTo && new Date(rc.validTo) <= now) return false;
      return true;
    }) || null
  );
}

/**
 * rotateStrategy:
 * - "reject" -> kdy existuje active, vrátí error
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
  const key = normCodeKey(code);

  if (!normalizedDisplay || !key) {
    const err = new Error("Invalid redeem code");
    err.code = "INVALID_REDEEM_CODE";
    throw err;
  }

  card.redeemCodes.push({
    // code = pro display (mue obsahovat pomlcky)
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
 * - najde kartu podle merchantId + redeemCodes.codeKey
 * - validuje active + validTo
 * - provede redeem podle redeemCode.purpose (reward/coupon)
 * - zapíe CardEvent
 */

export async function redeemByCodeForMerchant({
  Card,
  CardEvent,
  merchantId,
  code,
  source = "merchant-scan",
  actorId = merchantId,
}) {
  const key = normCodeKey(code);

  if (!key) {
    return { ok: false, status: 400, error: "code is required" };
  }

  const now = new Date();

  const cardMatchQuery = {
    merchantId,
    redeemCodes: { $elemMatch: { codeKey: key, status: "active" } },
  };

  const card = await Card.findOne(cardMatchQuery);

  if (!card) {
    return { ok: false, status: 404, error: "Code not found" };
  }

  await ensureCardHasScanCode(card);

  const list = Array.isArray(card.redeemCodes) ? card.redeemCodes : [];
  const redeem = list.find((x) => {
    if (!x || x.status !== "active") return false;

    const xKey = normCodeKey(x.codeKey ?? x.code);
    return xKey === key;
  });

  const purpose = redeem?.purpose || "reward"; // backward compatible

  const logFailure = async (reason, status, error) => {
    await CardEvent.create(
      buildCardEventPayload({
        merchantId,
        cardId: card._id,
        walletToken: card.walletToken,
        type: "REDEEM_FAILED",
        cardType: card.type ?? "stamps",
        templateId: card.templateId ?? null,
        actor: { type: "merchant", actorId, source },
        payload: {
          code,
          codeKey: key,
          purpose,
          reason,
        },
      })
    );

    return { ok: false, status, error };
  };

  if (!redeem) {
    return logFailure("not_found", 404, "Code not found");
  }

  if (redeem.validTo) {
    const vt = new Date(redeem.validTo);
    if (!Number.isNaN(vt.getTime()) && vt <= now) {
      await Card.findOneAndUpdate(
        {
          _id: card._id,
          merchantId,
          redeemCodes: {
            $elemMatch: {
              codeKey: key,
              status: "active",
              ...(purpose ? { purpose } : {}),
              validTo: redeem.validTo,
            },
          },
        },
        {
          $set: {
            "redeemCodes.$.status": "expired",
            "redeemCodes.$.expiredAt": now,
          },
        },
        { new: true }
      );

      return logFailure("expired", 410, "Code expired");
    }
  }

  if (purpose === "reward" && Number(card.rewards || 0) < 1) {
    return logFailure("no_rewards", 400, "No rewards available");
  }

  const updateQuery = {
    _id: card._id,
    merchantId,
    ...(purpose === "reward" ? { rewards: { $gt: 0 } } : {}),
    redeemCodes: {
      $elemMatch: {
        codeKey: key,
        status: "active",
        ...(purpose ? { purpose } : {}),
        ...(redeem.validTo
          ? { validTo: redeem.validTo }
          : { $or: [{ validTo: { $exists: false } }, { validTo: null }, { validTo: { $gt: now } }] }),
      },
    },
  };

  const updateDoc = {
    $set: {
      "redeemCodes.$.status": "used",
      "redeemCodes.$.redeemedAt": now,
      "redeemCodes.$.updatedAt": now,
      "redeemCodes.$.meta.redeemedBy": merchantId,
      lastEventAt: now,
    },
  };

  if (purpose === "reward") {
    updateDoc.$inc = { rewards: -1 };
  }

  const updatedCard = await Card.findOneAndUpdate(updateQuery, updateDoc, { new: true }).lean();

  console.log("REDEEM_ATOMIC", { key, ok: Boolean(updatedCard) });

  if (!updatedCard) {
    return { ok: false, status: 409, error: "Code already used or invalid" };
  }

  const updatedRedeem = (updatedCard.redeemCodes || []).find(
    (rc) => normCodeKey(rc?.codeKey ?? rc?.code) === key
  );

  if (purpose === "reward") {
    await CardEvent.create(
      buildCardEventPayload({
        merchantId,
        cardId: updatedCard._id,
        walletToken: updatedCard.walletToken,
        type: "REWARD_REDEEMED",
        deltaRewards: -1,
        cardType: updatedCard.type ?? "stamps",
        templateId: updatedCard.templateId ?? null,
        actor: { type: "merchant", actorId, source },
        payload: { code, codeKey: key, purpose: "reward" },
      })
    );

    return {
      ok: true,
      status: 200,
      card: updatedCard,
      purpose: "reward",
      code,
      meta: updatedRedeem?.meta ?? null,
    };
  }

  if (purpose === "coupon") {
    await CardEvent.create(
      buildCardEventPayload({
        merchantId,
        cardId: updatedCard._id,
        walletToken: updatedCard.walletToken,
        type: "COUPON_REDEEMED",
        cardType: updatedCard.type ?? "coupon",
        templateId: updatedCard.templateId ?? null,
        actor: { type: "merchant", actorId, source },
        payload: {
          code,
          codeKey: key,
          purpose: "coupon",
          meta: updatedRedeem?.meta ?? null,
        },
      })
    );

    return {
      ok: true,
      status: 200,
      card: updatedCard,
      purpose: "coupon",
      code,
      meta: updatedRedeem?.meta ?? null,
    };
  }

  return logFailure("unsupported_purpose", 409, "Redeem purpose not supported");
}
