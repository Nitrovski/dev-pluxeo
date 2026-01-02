// backend/src/lib/push/pushRateLimit.js
import { WalletPushLog } from "../../models/walletPushLog.model.js";

export async function canSendWalletNotify({ objectId, now = new Date() }) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const count = await WalletPushLog.countDocuments({
    objectId,
    notify: true,
    createdAt: { $gte: since },
    status: "sent",
  });

  return count < 3;
}

export async function wasRecentlySent({ dedupeKey, minutes = 60 }) {
  const since = new Date(Date.now() - minutes * 60 * 1000);

  const found = await WalletPushLog.findOne({
    dedupeKey,
    createdAt: { $gte: since },
    status: "sent",
  }).lean();

  return !!found;
}
