// lib/googleWalletAuth.js

export function loadGoogleWalletServiceAccount() {
  const base64 = process.env.GOOGLE_WALLET_SA_JSON_BASE64;

  if (!base64) {
    throw new Error("Missing GOOGLE_WALLET_SA_JSON_BASE64 environment variable");
  }

  let decoded;
  try {
    decoded = Buffer.from(base64, "base64").toString("utf8");
  } catch (err) {
    throw new Error("GOOGLE_WALLET_SA_JSON_BASE64 is not valid base64");
  }

  let json;
  try {
    json = JSON.parse(decoded);
  } catch (err) {
    throw new Error("GOOGLE_WALLET_SA_JSON_BASE64 does not contain valid JSON");
  }

  if (!json || json.type !== "service_account") {
    throw new Error('Service account JSON must have type "service_account"');
  }

  if (!json.client_email) {
    throw new Error("Service account JSON must include client_email");
  }

  if (!json.private_key || !json.private_key_id) {
    throw new Error("Google Wallet credentials missing private_key/private_key_id");
  }

  return json;
}
