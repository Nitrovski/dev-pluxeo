// backend/src/services/push/walletPush.service.js
import { googleWalletConfig } from "../../config/googleWallet.config.js";
import { makeObjectId } from "../../lib/googleWalletIds.js";
import { addGenericWalletMessage } from "../../lib/push/googleWalletPush.js";
import { canSendWalletNotify, wasRecentlySent } from "../../lib/push/pushRateLimit.js";
import { WalletPushLog } from "../../models/walletPushLog.model.js";

export async function sendCardWalletPush({
  cardId,
  kind,
  header,
  body,
  notify = true,
  dedupeKey,
}) {
  const objectId = makeObjectId({
    issuerId: googleWalletConfig.issuerId,
    cardId: String(cardId),
  });

  // Dedupe (např. stejné promo dokola)
  if (dedupeKey) {
    const already = await wasRecentlySent({ dedupeKey, minutes: 60 * 24 });
    if (already) {
      await WalletPushLog.create({
        cardId,
        objectId,
        kind,
        notify,
        dedupeKey,
        status: "skipped",
        error: "deduped",
      });
      return { ok: true, skipped: true, reason: "deduped" };
    }
  }

  // Rate limit pro TEXT_AND_NOTIFY
  if (notify) {
    const allowed = await canSendWalletNotify({ objectId });
    if (!allowed) {
      await WalletPushLog.create({
        cardId,
        objectId,
        kind,
        notify,
        dedupeKey,
        status: "skipped",
        error: "rate_limited_3_per_24h",
      });
      return { ok: true, skipped: true, reason: "rate_limited" };
    }
  }

  try {
    const data = await addGenericWalletMessage({ objectId, header, body, notify });

    await WalletPushLog.create({
      cardId,
      objectId,
      kind,
      notify,
      dedupeKey,
      status: "sent",
    });

    return { ok: true, objectId, data };
  } catch (err) {
    await WalletPushLog.create({
      cardId,
      objectId,
      kind,
      notify,
      dedupeKey,
      status: "failed",
      error: err?.message || String(err),
    });
    throw err;
  }
}
