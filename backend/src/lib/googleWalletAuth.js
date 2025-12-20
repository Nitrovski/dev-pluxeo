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

  if (!json.client_email || !json.private_key) {
    throw new Error("Service account JSON must include client_email and private_key");
  }

  return json;
}
