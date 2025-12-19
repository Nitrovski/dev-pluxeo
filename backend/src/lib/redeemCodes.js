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
 * - fallback pro stará data: redeemCodes.code (vcetne alnum varianty)
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
  // --- safe normalizace (aby nikdy nepadla 500) ---
  const raw = String(code || "");
  const input = raw.trim().toUpperCase();
  const inputAlnum = input.replace(/[^A-Z0-9]/g, "");

  // safe codeKey() – pokud tvoje codeKey() nekdy throwne, tak to chytíme
  let key = null;
  try {
    // pokud máš codeKey helper, použij ho
    key = codeKey(raw);
  } catch (e) {
    key = null;
  }
  // fallback: alnum forma je pro lookup prakticky “codeKey”
  if (!key) key = inputAlnum;

  if (!input || !key) {
    return { ok: false, status: 400, error: "code is required" };
  }

  const now = new Date();

  // 1) Najdi kartu primárne pres codeKey
  let card = await Card.findOne({
    merchantId,
    "redeemCodes.codeKey": key,
  });

  // 2) Fallback pro historická data: redeemCodes.code (presný i alnum)
  if (!card) {
    card = await Card.findOne({
      merchantId,
      "redeemCodes.code": { $in: [input, inputAlnum] },
    });
  }

  if (!card) {
    return { ok: false, status: 404, error: "Code not found" };
  }

  const list = Array.isArray(card.redeemCodes) ? card.redeemCodes : [];
  if (list.length === 0) {
    return { ok: false, status: 400, error: "No redeem codes available" };
  }

  // Najdi konkrétní redeem záznam
  const idx = list.findIndex((x) => {
    if (!x) return false;
    if (x.status !== "active") return false;

    const xCode = typeof x.code === "string" ? x.code.trim().toUpperCase() : "";
    const xCodeAlnum = xCode.replace(/[^A-Z0-9]/g, "");

    // preferuj uložený codeKey, jinak fallback na alnum z code
    const xKey = x.codeKey ? String(x.codeKey) : xCodeAlnum;

    if (xKey !== key) return false;

    if (x.validTo) {
      const vt = new Date(x.validTo);
      if (!Number.isNaN(vt.getTime()) && vt <= now) return false;
    }

    return true;
  });

  if (idx === -1) {
    return {
      ok: false,
      status: 400,
      error: "Invalid, expired, or already redeemed code",
    };
  }

  const redeem = list[idx];
  const purpose = redeem.purpose || "reward"; // backward compatible

  // ------------------------------------------------------------
  // REWARD: nejdrív over rewards, až pak oznac redeem jako redeemed
  // ------------------------------------------------------------
  if (purpose === "reward") {
    const currentRewards = Number(card.rewards || 0);
    if (currentRewards < 1) {
      return { ok: false, status: 400, error: "No rewards available" };
    }

    // oznac kód redeemed + odecti reward
    card.redeemCodes[idx].status = "redeemed";
    card.redeemCodes[idx].redeemedAt = now;
    card.lastEventAt = now;

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

    return {
      ok: true,
      status: 200,
      card,
      purpose: "reward",
      code: input,
      meta: null,
    };
  }

  // ------------------------------------------------------------
  // COUPON
  // ------------------------------------------------------------
  if (purpose === "coupon") {
    // oznac kód redeemed
    card.redeemCodes[idx].status = "redeemed";
    card.redeemCodes[idx].redeemedAt = now;
    card.lastEventAt = now;

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
      payload: {
        code: input,
        codeKey: key,
        purpose: "coupon",
        meta: redeem.meta ?? null,
      },
    });

    return {
      ok: true,
      status: 200,
      card,
      purpose: "coupon",
      code: input,
      meta: redeem.meta ?? null,
    };
  }

  return {
    ok: false,
    status: 409,
    error: "Redeem purpose not supported",
    purpose,
    code: input,
  };
}
