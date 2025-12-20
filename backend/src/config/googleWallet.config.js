import 'dotenv/config';

const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
if (!issuerId) {
  throw new Error('Missing required env var GOOGLE_WALLET_ISSUER_ID');
}

const serviceAccountJsonBase64 = process.env.GOOGLE_WALLET_SA_JSON_BASE64;
if (!serviceAccountJsonBase64) {
  throw new Error('Missing required env var GOOGLE_WALLET_SA_JSON_BASE64');
}

const classPrefix = process.env.GOOGLE_WALLET_CLASS_PREFIX || 'pluxeo';

export const googleWalletConfig = {
  issuerId,
  classPrefix,
};
