import test from "node:test";
import assert from "node:assert";
import { loadGoogleWalletServiceAccount } from "../src/lib/googleWalletAuth.js";

const ORIGINAL_ENV = process.env.GOOGLE_WALLET_SA_JSON_BASE64;

function toBase64(json) {
  return Buffer.from(JSON.stringify(json), "utf8").toString("base64");
}

test("loads and validates a service account JSON", (t) => {
  t.after(() => {
    process.env.GOOGLE_WALLET_SA_JSON_BASE64 = ORIGINAL_ENV;
  });

  const serviceAccount = {
    type: "service_account",
    client_email: "wallet@example.com",
    private_key: "-----BEGIN PRIVATE KEY-----ABC-----END PRIVATE KEY-----",
  };

  process.env.GOOGLE_WALLET_SA_JSON_BASE64 = toBase64(serviceAccount);

  const loaded = loadGoogleWalletServiceAccount();

  assert.deepStrictEqual(loaded, serviceAccount);
});

test("throws on missing base64 env variable", (t) => {
  t.after(() => {
    process.env.GOOGLE_WALLET_SA_JSON_BASE64 = ORIGINAL_ENV;
  });

  delete process.env.GOOGLE_WALLET_SA_JSON_BASE64;

  assert.throws(() => loadGoogleWalletServiceAccount(), {
    message: "Missing GOOGLE_WALLET_SA_JSON_BASE64 environment variable",
  });
});

test("throws when JSON is malformed", (t) => {
  t.after(() => {
    process.env.GOOGLE_WALLET_SA_JSON_BASE64 = ORIGINAL_ENV;
  });

  process.env.GOOGLE_WALLET_SA_JSON_BASE64 = Buffer.from("not-json", "utf8").toString(
    "base64"
  );

  assert.throws(() => loadGoogleWalletServiceAccount(), {
    message: "GOOGLE_WALLET_SA_JSON_BASE64 does not contain valid JSON",
  });
});

test("requires proper type and required fields", (t) => {
  t.after(() => {
    process.env.GOOGLE_WALLET_SA_JSON_BASE64 = ORIGINAL_ENV;
  });

  process.env.GOOGLE_WALLET_SA_JSON_BASE64 = toBase64({
    type: "other",
    client_email: "wallet@example.com",
    private_key: "key",
  });

  assert.throws(() => loadGoogleWalletServiceAccount(), {
    message: 'Service account JSON must have type "service_account"',
  });

  process.env.GOOGLE_WALLET_SA_JSON_BASE64 = toBase64({
    type: "service_account",
    client_email: "wallet@example.com",
  });

  assert.throws(() => loadGoogleWalletServiceAccount(), {
    message: "Service account JSON must include client_email and private_key",
  });
});
