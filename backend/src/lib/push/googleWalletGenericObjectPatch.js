// backend/src/lib/push/googleWalletGenericObjectPatch.js
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

export async function getGenericObject({ objectId }) {
  if (!objectId) throw new Error("getGenericObject: missing objectId");

  const client = getWalletAuthClient();
  const url = `${WALLET_BASE_URL}/genericObject/${encodeURIComponent(objectId)}`;

  const res = await client.request({ url, method: "GET" });
  return res?.data ?? null;
}

export async function patchGenericObjectTextModuleIndex({ objectId, index, header, body }) {
  if (!objectId) throw new Error("patchGenericObjectTextModuleIndex: missing objectId");
  if (typeof index !== "number" || Number.isNaN(index)) {
    throw new Error("patchGenericObjectTextModuleIndex: invalid index");
  }

  const headerText = String(header ?? "").trim();
  const bodyText = String(body ?? "").trim();
  if (!headerText || !bodyText) return null;

  const object = await getGenericObject({ objectId });
  const textModulesData = Array.isArray(object?.textModulesData)
    ? [...object.textModulesData]
    : [];

  for (let i = 0; i <= index; i += 1) {
    if (!textModulesData[i]) {
      textModulesData[i] = {
        id: `tm_${i}`,
        header: "",
        body: "",
      };
    }
  }

  const existing = textModulesData[index] || {};
  textModulesData[index] = {
    id: existing.id || `tm_${index}`,
    header: "Aktuální akce",
    body: `${headerText}\n${bodyText}`,
  };

  const client = getWalletAuthClient();
  const url = `${WALLET_BASE_URL}/genericObject/${encodeURIComponent(objectId)}?updateMask=textModulesData`;
  const payload = { textModulesData };

  const res = await client.request({ url, method: "PATCH", data: payload });
  return res?.data ?? null;
}
