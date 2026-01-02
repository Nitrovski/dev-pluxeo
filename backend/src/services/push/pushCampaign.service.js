import { PushCampaign } from "../../models/pushCampaign.model.js";
import { WalletPushLog } from "../../models/walletPushLog.model.js";
import { Card } from "../../models/card.model.js";

import { googleWalletConfig } from "../../config/googleWallet.config.js";
import { makeObjectId } from "../../lib/googleWalletIds.js";
import { addGenericWalletMessage } from "../../lib/push/googleWalletPush.js";

function resolveObjectId(card) {
  return (
    card?.googleWallet?.objectId ||
    makeObjectId({ issuerId: googleWalletConfig.issuerId, cardId: String(card._id) })
  );
}

export async function runCampaignSend(campaignId) {
  // lock: draft/queued -> processing
  const campaign = await PushCampaign.findOneAndUpdate(
    { _id: campaignId, status: { $in: ["draft", "queued"] } },
    { $set: { status: "processing", lastError: "" } },
    { new: true }
  ).lean();

  if (!campaign) return { ok: false, skipped: true, reason: "not_due_or_already_processing" };

  try {
    // MVP audience: all cards merchant
    const cards = await Card.find({ merchantId: campaign.merchantId })
      .select({ _id: 1, googleWallet: 1 })
      .lean();

    // MVP doporucení: posílat jen na karty, které mají uložené objectId
    // (tzn. reálne jsou/ byly syncnuté do Google Wallet flow)
    const targets = cards.filter((c) => c?.googleWallet?.objectId);

    let sent = 0;
    let failed = 0;

    for (const card of targets) {
      const objectId = resolveObjectId(card);

      try {
        await addGenericWalletMessage({
          objectId,
          header: campaign.header,
          body: campaign.body,
          notify: campaign.notify,
        });

        await WalletPushLog.create({
          merchantId: campaign.merchantId,
          campaignId: campaign._id,
          cardId: card._id,
          objectId,
          notify: campaign.notify,
          status: "sent",
          kind: "campaign",
        });

        sent += 1;
      } catch (e) {
        failed += 1;
        await WalletPushLog.create({
          merchantId: campaign.merchantId,
          campaignId: campaign._id,
          cardId: card._id,
          objectId,
          notify: campaign.notify,
          status: "failed",
          kind: "campaign",
          error: e?.message || String(e),
        });
      }
    }

    await PushCampaign.updateOne(
      { _id: campaign._id },
      { $set: { status: failed > 0 ? "failed" : "sent", lastError: failed > 0 ? `${failed} failures` : "" } }
    );

    return { ok: true, sent, failed, total: targets.length };
  } catch (err) {
    await PushCampaign.updateOne(
      { _id: campaign._id },
      { $set: { status: "failed", lastError: err?.message || String(err) } }
    );
    throw err;
  }
}
