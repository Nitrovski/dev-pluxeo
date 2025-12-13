import crypto from "crypto";

/**
 * Vygeneruje krátký, URL-safe enrollment code
 * vhodný pro QR i URL
 */
export function generateEnrollmentCode() {
  // 9 bytes ? cca 12 znaku
  return crypto.randomBytes(9).toString("base64url");
}
