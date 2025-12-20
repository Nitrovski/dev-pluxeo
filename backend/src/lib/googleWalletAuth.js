// lib/googleWalletAuth.js

export function loadGoogleWalletServiceAccount() {
  const base64 = process.env.GOOGLE_WALLET_SA_JSON_BASE64;

  if (!base64) {
    throw new Error("Missing GOOGLE_WALLET_SA_JSON_BASE64 env var");
  }

  let json;
  try {
    json = JSON.parse(
      Buffer.from(base64, "base64").toString("utf8")
    );
  } catch (err) {
    throw new Error("Failed to decode GOOGLE_WALLET_SA_JSON_BASE64");
  }

  if (json.type !== "service_account") {
    throw new Error("Invalid service account JSON");
  }

  if (!json.client_email || !json.private_key) {
    throw new Error("Service account JSON missing fields");
  }

  return json;
}
