const REQUIRED_ENV_VARS = [
  "APPLE_WALLET_TEAM_ID",
  "APPLE_WALLET_PASS_TYPE_ID",
  "APPLE_WALLET_PASS_P12_BASE64",
  "APPLE_WALLET_PASS_P12_PASSWORD",
  "APPLE_WALLET_WWDR_PEM_BASE64",
];

export function getAppleWalletConfig({ logger } = {}) {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length) {
    missing.forEach((key) => {
      if (logger?.error) {
        logger.error({ envKey: key }, `[APPLE_WALLET] missing env: ${key}`);
      } else {
        console.error(`[APPLE_WALLET] missing env: ${key}`);
      }
    });
    throw new Error(`Missing Apple Wallet config: ${missing.join(", ")}`);
  }

  return {
    teamId: process.env.APPLE_WALLET_TEAM_ID,
    passTypeId: process.env.APPLE_WALLET_PASS_TYPE_ID,
    passP12Base64: process.env.APPLE_WALLET_PASS_P12_BASE64,
    passP12Password: process.env.APPLE_WALLET_PASS_P12_PASSWORD,
    wwdrPemBase64: process.env.APPLE_WALLET_WWDR_PEM_BASE64,
  };
}
