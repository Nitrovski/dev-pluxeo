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

export async function walletRequest({ method, path, body }) {
  const authClient = getWalletAuthClient();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${WALLET_BASE_URL}${normalizedPath}`;

  console.log("GW_API_REQUEST", { method, path: normalizedPath });

  const authHeaders = await authClient.getRequestHeaders();
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
