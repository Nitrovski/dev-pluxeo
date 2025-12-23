import { JWT } from "google-auth-library";
import { loadGoogleWalletServiceAccount } from "./googleWalletAuth.js";

const WALLET_BASE_URL = "https://walletobjects.googleapis.com";
const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

let walletAuthClient;

export function getWalletAuthClient() {
  if (!walletAuthClient) {
    const serviceAccount = loadGoogleWalletServiceAccount();

    walletAuthClient = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: [WALLET_SCOPE],
    });
  }

  return walletAuthClient;
}

// --- DEV helper: safe preview to avoid massive logs / circulars ---
function safePreview(value, maxLen = 8000) {
  try {
    const json = JSON.stringify(value);
    if (json.length <= maxLen) return value;
    // If too large, return a truncated string preview
    return json.slice(0, maxLen) + "…(truncated)";
  } catch (_err) {
    // Fallback
    try {
      const s = String(value);
      return s.length <= maxLen ? s : s.slice(0, maxLen) + "…(truncated)";
    } catch (_err2) {
      return "[unserializable]";
    }
  }
}

export async function walletRequest({ method, path, body }) {
  const authClient = getWalletAuthClient();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${WALLET_BASE_URL}${normalizedPath}`;

  console.log("GW_API_REQUEST", { method, path: normalizedPath });

  // ✅ Ensure token is minted
  await authClient.authorize();

  // ✅ IMPORTANT: pass URL so Authorization header is reliably included
  const authHeaders = await authClient.getRequestHeaders(url);

  // Dev-only debug: confirm Authorization header exists
  if (process.env.NODE_ENV !== "production") {
    const keys = Object.keys(authHeaders || {});
    const hasAuth = Boolean(authHeaders?.Authorization || authHeaders?.authorization);
    console.log("GW authHeaders keys:", keys);
    console.log("GW Authorization present?", hasAuth);
  }

  const headers = {
    ...authHeaders,
    "Content-Type": "application/json",
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const rawResponseBody = await response.text();
  const parsedResponseBody = rawResponseBody
    ? (() => {
        try {
          return JSON.parse(rawResponseBody);
        } catch (_err) {
          return rawResponseBody;
        }
      })()
    : undefined;

  if (!response.ok) {
    // ✅ DEV-only: show request payload preview on 4xx/5xx
    // Helps find invalidResource issues like: "header must be set"
    if (process.env.NODE_ENV !== "production") {
      const m = String(method || "").toUpperCase();
      const isWrite = m === "POST" || m === "PUT" || m === "PATCH";
      if (isWrite) {
        console.error("GW_API_ERROR_REQUEST_PREVIEW", {
          method: m,
          path: normalizedPath,
          status: response.status,
          requestBodyPreview: safePreview(body),
        });
      }
    }

    const error = new Error(
      `Google Wallet API request failed with status ${response.status}`
    );
    error.status = response.status;
    error.responseBody = parsedResponseBody;
    error.rawResponseBody = rawResponseBody;
    throw error;
  }

  return parsedResponseBody;
}

export function isGoogleWalletBadRequest(err) {
  return err?.status === 400 && Boolean(err?.responseBody);
}

export function buildGoogleWalletErrorResponse(err) {
  const responseBody = err?.responseBody;
  const message =
    responseBody?.error?.message ||
    err?.message ||
    "Google Wallet API request failed";

  return {
    ok: false,
    provider: "google",
    message,
    errors: responseBody?.error?.errors,
    raw: responseBody,
  };
}
