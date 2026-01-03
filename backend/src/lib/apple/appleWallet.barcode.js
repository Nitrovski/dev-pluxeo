export function pickAppleBarcodeMessage({ publicPayload, walletToken }) {
  const candidates = [
    publicPayload?.redeemCode?.code,
    publicPayload?.activeRedeemCode?.code,
    publicPayload?.redeem?.code,
    publicPayload?.redeem?.redeemCode,
    publicPayload?.redeem?.value,
    publicPayload?.activeCode,
  ];

  const picked = candidates.find((value) => String(value || "").trim().length > 0);

  return picked ? String(picked).trim() : String(walletToken || "").trim();
}
