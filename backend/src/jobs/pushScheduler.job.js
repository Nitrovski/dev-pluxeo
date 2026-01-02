// backend/src/jobs/pushScheduler.job.js
import { PushCampaign } from "../models/pushCampaign.model.js";
import { runCampaignSend } from "../services/push/pushCampaign.service.js";

let started = false;

export function startPushScheduler() {
  if (started) return;
  started = true;

  setInterval(async () => {
    const now = new Date();

    const due = await PushCampaign.find({
      mode: "scheduled",
      runAt: { $lte: now },
      status: { $in: ["draft", "queued"] },
    })
      .sort({ runAt: 1 })
      .limit(5)
      .lean();

    for (const c of due) {
      try {
        await runCampaignSend(c._id);
      } catch {
        // ignore, campaign marked failed in service
      }
    }
  }, 60_000);
}
