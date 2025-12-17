// src/lib/shareCodes.js
import crypto from "crypto";

/**
 * Vygeneruje verejný share kód pro kartu (vizitka).
 * Používá se pro verejné sdílení karty / vizitky.
 */
export function generateShareCode() {
  return crypto.randomBytes(9).toString("base64url");
}

/**
 * Zajistí, že karta má aktivní share kód.
 * Pokud neexistuje, vygeneruje nový.
 */
export function ensureShareCardCode(card) {
  if (!card.share) {
    card.share = {};
  }

  if (!card.share.code) {
    card.share.code = generateShareCode();
    card.share.status = "active";
    card.share.rotatedAt = new Date();
  }

  return card.share;
}

/**
 * Rotace share kódu (napr. na žádost merchanta).
 */
export function rotateShareCardCode(card) {
  card.share.code = generateShareCode();
  card.share.status = "active";
  card.share.rotatedAt = new Date();
  return card.share;
}

/**
 * Deaktivace sdílení karty (vizitky).
 */
export function disableShareCardCode(card) {
  if (!card.share) {
    card.share = {};
  }

  card.share.status = "disabled";
  return card.share;
}
