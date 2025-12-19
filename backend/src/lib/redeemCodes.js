// src/lib/redeemCodes.js
import { buildCardEventPayload } from "./eventSchemas.js";

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
  const key = codeKey(code);

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
 * - najde kartu podle merchantId + redeemCodes.codeKey (primárne)
 * - fallback pro stará data: redeemCodes.code (vcetne alnum varianty)
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
  // --- safe normalizace (aby nikdy nepadla 500) ---
  const raw = String(code || "");
  const input = raw.trim().toUpperCase();
  const inputAlnum = input.replace(/[^A-Z0-9]/g, "");

  // safe codeKey()  pokud tvoje codeKey() nekdy throwne, tak to chytíme
  let key = null;
  try {
    // pokud má codeKey helper, pouij ho
    key = codeKey(raw);
  } catch (e) {
    key = null;
  }
  // fallback: alnum forma je pro lookup prakticky codeKey
  if (!key) key = inputAlnum;

  if (!input || !key) {
    return { ok: false, status: 400, error: "code is required" };
  }

  const now = new Date();

  const matchLookup = {
    merchantId,
    $or: [
      { "redeemCodes.codeKey": key },
      { "redeemCodes.code": { $in: [input, inputAlnum] } },
    ],
  };

  const card = await Card.findOne(matchLookup);

  if (!card) {
    return { ok: false, status: 404, error: "Code not found" };
  }

  const list = Array.isArray(card.redeemCodes) ? card.redeemCodes : [];
  if (list.length === 0) {
    return { ok: false, status: 400, error: "No redeem codes available" };
  }

  const redeemIndex = list.findIndex((x) => {
    if (!x) return false;

    const xCode = typeof x.code === "string" ? x.code.trim().toUpperCase() : "";
    const xCodeAlnum = xCode.replace(/[^A-Z0-9]/g, "");
    const xKey = x.codeKey ? String(x.codeKey) : xCodeAlnum;

    return xKey === key || xCode === input || xCodeAlnum === inputAlnum;
  });

  if (redeemIndex === -1) {
    return { ok: false, status: 404, error: "Code not found" };
  }

  const redeem = list[redeemIndex];
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
          code: input,
          codeKey: key,
          purpose,
          reason,
        },
      })
    );

    return { ok: false, status, error };
  };

  if (redeem.status !== "active") {
    return logFailure("inactive_code", 400, "Invalid, expired, or already redeemed code");
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
              status: "active",
              $or: [
                { codeKey: key },
                { code: { $in: [input, inputAlnum] } },
              ],
              validTo: redeem.validTo,
            },
          },
        },
        {
          $set: {
            "redeemCodes.$[target].status": "expired",
            "redeemCodes.$[target].expiredAt": now,
          },
        },
        {
          arrayFilters: [
            {
              "target.status": "active",
              $or: [
                { "target.codeKey": key },
                { "target.code": { $in: [input, inputAlnum] } },
              ],
            },
          ],
        }
      );

      return logFailure("expired", 410, "Code expired");
    }
  }

  if (purpose === "reward" && Number(card.rewards || 0) < 1) {
    return logFailure("no_rewards", 400, "No rewards available");
  }

  const validDateFilter = [
    { "target.validTo": { $exists: false } },
    { "target.validTo": null },
    { "target.validTo": { $gt: now } },
  ];

  const codeMatchFilter = [
    { "target.codeKey": key },
    { "target.code": { $in: [input, inputAlnum] } },
  ];

  const updateQuery = {
    _id: card._id,
    merchantId,
    ...(purpose === "reward" ? { rewards: { $gte: 1 } } : {}),
    redeemCodes: {
      $elemMatch: {
        status: "active",
        $and: [{ $or: codeMatchFilter }, { $or: validDateFilter }],
      },
    },
  };

  const updateDoc = {
    $set: {
      "redeemCodes.$[target].status": "redeemed",
      "redeemCodes.$[target].redeemedAt": now,
      lastEventAt: now,
    },
  };

  if (purpose === "reward") {
    updateDoc.$inc = { rewards: -1 };
  }

  const updatedCard = await Card.findOneAndUpdate(updateQuery, updateDoc, {
    new: true,
    arrayFilters: [
      {
        "target.status": "active",
        $and: [{ $or: codeMatchFilter }, { $or: validDateFilter }],
      },
    ],
  });

  if (!updatedCard) {
    return logFailure("concurrent_or_inactive", 400, "Invalid, expired, or already redeemed code");
  }

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
        payload: { code: input, codeKey: key, purpose: "reward" },
      })
    );

    return {
      ok: true,
      status: 200,
      card: updatedCard,
      purpose: "reward",
      code: input,
      meta: null,
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
          code: input,
          codeKey: key,
          purpose: "coupon",
          meta: redeem.meta ?? null,
        },
      })
    );

    return {
      ok: true,
      status: 200,
      card: updatedCard,
      purpose: "coupon",
      code: input,
      meta: redeem.meta ?? null,
    };
  }

  return logFailure("unsupported_purpose", 409, "Redeem purpose not supported");

}