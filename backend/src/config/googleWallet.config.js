import 'dotenv/config';

const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
if (!issuerId) {
  throw new Error('Missing required env var GOOGLE_WALLET_ISSUER_ID');
}

const serviceAccountJsonBase64 = process.env.GOOGLE_WALLET_SA_JSON_BASE64;
if (!serviceAccountJsonBase64) {
  throw new Error('Missing required env var GOOGLE_WALLET_SA_JSON_BASE64');
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isDevEnv = nodeEnv === 'development' || nodeEnv === 'test';

const defaultLogoUrl = process.env.GOOGLE_WALLET_DEFAULT_LOGO_URL?.trim();
if (!defaultLogoUrl && !isDevEnv) {
  throw new Error('Missing required env var GOOGLE_WALLET_DEFAULT_LOGO_URL');
}

const classPrefix = process.env.GOOGLE_WALLET_CLASS_PREFIX || 'pluxeo';
const WALLET_MODES = new Set(['generic_only', 'dual', 'loyalty_only']);

export function getGoogleWalletMode() {
  const mode = process.env.GOOGLE_WALLET_MODE?.trim().toLowerCase() || 'generic_only';

  if (!WALLET_MODES.has(mode)) {
    return 'generic_only';
  }

  return mode;
}

export const googleWalletConfig = {
  issuerId,
  classPrefix,
  defaultLogoUrl,
  isDevEnv,
  mode: getGoogleWalletMode(),
};
