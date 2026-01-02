// backend/src/lib/push/googleWalletPush.js
import { JWT } from "google-auth-library";
import { loadGoogleWalletServiceAccount } from "../googleWalletAuth.js";

const WALLET_BASE_URL = "https://walletobjects.googleapis.com/walletobjects/v1";
const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

let walletAuthClient;

function getWalletAuthClient() {
  if (!walletAuthClient) {
    const sa = loadGoogleWalletServiceAccount();
    walletAuthClient = new JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: [WALLET_SCOPE],
    });
  }
  return walletAuthClient;
}

export async function addGenericWalletMessage({ objectId, header, body, notify = true }) {
  if (!objectId) throw new Error("addGenericWalletMessage: missing objectId");

  const client = getWalletAuthClient();
  const url = `${WALLET_BASE_URL}/genericObject/${encodeURIComponent(objectId)}/addMessage`;

  const payload = {
    message: {
      header: String(header || "").slice(0, 60),
      body: String(body || "").slice(0, 500),
      messageType: notify ? "TEXT_AND_NOTIFY" : "TEXT",
    },
  };

  const res = await client.request({ url, method: "POST", data: payload });
  return res?.data ?? null;
}
