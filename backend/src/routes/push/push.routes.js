// backend/src/routes/push/push.routes.js
import { PushCampaign } from "../../models/pushCampaign.model.js";
import { runCampaignSend } from "../../services/push/pushCampaign.service.js";

export async function pushRoutes(fastify) {
  // auth – použij stejný pattern jako jinde
  fastify.addHook("preHandler", fastify.clerkAuth);

  fastify.get("/campaigns", async (req) => {
    const merchantId = req.auth.userId;

    const items = await PushCampaign.find({ merchantId })
      .sort({ createdAt: -1 })
      .lean();

    return { ok: true, items };
  });

  fastify.post("/campaigns", async (req) => {
    const merchantId = req.auth.userId;
    const { name, header, body, notify = true, mode = "manual", runAt = null } = req.body;

    const campaign = await PushCampaign.create({
      merchantId,
      name,
      header,
      body,
      notify,
      mode,
      runAt: runAt ? new Date(runAt) : null,
      status: mode === "scheduled" && runAt ? "queued" : "draft",
    });

    return { ok: true, campaign };
  });

  fastify.put("/campaigns/:id", async (req) => {
    const merchantId = req.auth.userId;
    const { id } = req.params;
    const patch = req.body;

    const updated = await PushCampaign.findOneAndUpdate(
      { _id: id, merchantId },
      {
        $set: {
          name: patch.name,
          header: patch.header,
          body: patch.body,
          notify: patch.notify,
          mode: patch.mode,
          runAt: patch.runAt ? new Date(patch.runAt) : null,
          status: patch.mode === "scheduled" && patch.runAt ? "queued" : "draft",
        },
      },
      { new: true }
    ).lean();

    return { ok: true, campaign: updated };
  });

  fastify.post("/campaigns/:id/send-now", async (req) => {
    const merchantId = req.auth.userId;
    const { id } = req.params;

    const campaign = await PushCampaign.findOne({ _id: id, merchantId });
    if (!campaign) {
      return { ok: false, message: "Campaign not found" };
    }

    await PushCampaign.updateOne(
      { _id: id },
      { $set: { status: "queued", mode: "manual", runAt: null } }
    );

    const result = await runCampaignSend(id);
    return { ok: true, result };
  });
}
