// lib/googleWalletAuth.js
import { GoogleAuth } from "google-auth-library";

/**
 * Google Wallet Objects API scope
 * Docs: https://developers.google.com/wallet
 */
const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

/**
 * Load and validate the Google Wallet Service Account JSON from env var:
 * GOOGLE_WALLET_SA_JSON_BASE64
 */
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

  // Normalize private_key newlines if it contains escaped \n (common in env)
  if (typeof json.private_key === "string" && json.private_key.includes("\\n")) {
    json.private_key = json.private_key.replace(/\\n/g, "\n");
  }

  return json;
}

/**
 * Fetch OAuth2 access token for Google Wallet Objects API using the service account.
 * Returns a non-empty access token string.
 */
export async function getGoogleWalletAccessToken() {
  const creds = loadGoogleWalletServiceAccount();

  const auth = new GoogleAuth({
    credentials: creds,
    scopes: [WALLET_SCOPE],
  });

  const client = await auth.getClient();

  // google-auth-library returns either string or { token } depending on version
  const tokenResp = await client.getAccessToken();
  const token =
    typeof tokenResp === "string" ? tokenResp : tokenResp?.token;

  if (!token) {
    throw new Error("Failed to obtain Google Wallet access token");
  }

  // Optional debug (safe-ish): prints only prefix
  if (process.env.NODE_ENV !== "production") {
    console.log("GW accessToken present? true", token.slice(0, 12));
  }

  return token;
}

/**
 * Helper to build standard headers for Google Wallet API calls.
 */
export async function getGoogleWalletAuthHeaders(extraHeaders = {}) {
  const token = await getGoogleWalletAccessToken();

  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extraHeaders,
  };
}
