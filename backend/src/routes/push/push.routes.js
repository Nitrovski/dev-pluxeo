// backend/src/routes/push/push.routes.js
import { PushCampaign } from "../../models/pushCampaign.model.js";
import { runCampaignSend } from "../../services/push/pushCampaign.service.js";
import { getAuth } from "@clerk/fastify";

function requireMerchantId(req) {
  const auth = getAuth(req);
  const merchantId = auth?.userId;
  if (!merchantId) return null;
  return merchantId;
}

export async function pushRoutes(fastify) {
  // DEBUG: confirm plugin loaded & routes registered
  fastify.log.info("[push] registering push routes");

  fastify.get("/campaigns", async (req, reply) => {
    const merchantId = requireMerchantId(req);
    if (!merchantId) return reply.code(401).send({ ok: false, message: "Unauthorized" });

    const items = await PushCampaign.find({ merchantId })
      .sort({ createdAt: -1 })
      .lean();

    return { ok: true, items };
  });

  fastify.post("/campaigns", async (req, reply) => {
    const merchantId = requireMerchantId(req);
    if (!merchantId) return reply.code(401).send({ ok: false, message: "Unauthorized" });

    const { name, header, body, notify = true, mode = "manual", runAt = null } = req.body || {};

    if (!header || !body) {
      return reply.code(400).send({ ok: false, message: "Missing header/body" });
    }

    const campaign = await PushCampaign.create({
      merchantId,
      name: name || "",
      header,
      body,
      notify: !!notify,
      mode: mode === "scheduled" ? "scheduled" : "manual",
      runAt: runAt ? new Date(runAt) : null,
      status: mode === "scheduled" && runAt ? "queued" : "draft",
    });

    return { ok: true, campaign };
  });

  fastify.put("/campaigns/:id", async (req, reply) => {
    const merchantId = requireMerchantId(req);
    if (!merchantId) return reply.code(401).send({ ok: false, message: "Unauthorized" });

    const { id } = req.params;
    const patch = req.body || {};

    const updated = await PushCampaign.findOneAndUpdate(
      { _id: id, merchantId },
      {
        $set: {
          name: patch.name ?? "",
          header: patch.header,
          body: patch.body,
          notify: patch.notify ?? true,
          mode: patch.mode === "scheduled" ? "scheduled" : "manual",
          runAt: patch.runAt ? new Date(patch.runAt) : null,
          status: patch.mode === "scheduled" && patch.runAt ? "queued" : "draft",
        },
      },
      { new: true }
    ).lean();

    if (!updated) return reply.code(404).send({ ok: false, message: "Campaign not found" });

    return { ok: true, campaign: updated };
  });

  fastify.post("/campaigns/:id/send-now", async (req, reply) => {
    const merchantId = requireMerchantId(req);
    if (!merchantId) return reply.code(401).send({ ok: false, message: "Unauthorized" });

    const { id } = req.params;

    const campaign = await PushCampaign.findOne({ _id: id, merchantId });
    if (!campaign) return reply.code(404).send({ ok: false, message: "Campaign not found" });

    await PushCampaign.updateOne(
      { _id: id, merchantId },
      { $set: { status: "queued", mode: "manual", runAt: null } }
    );

    const result = await runCampaignSend(id);
    return { ok: true, result };
  });
}
