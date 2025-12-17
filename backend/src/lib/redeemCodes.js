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
