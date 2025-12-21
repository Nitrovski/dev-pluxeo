import { getAuth } from "@clerk/fastify";
import { Card } from "../models/card.model.js";
import {
  createAddToWalletLinkForCard,
  ensureLoyaltyClassForMerchant,
} from "../lib/googleWalletPass.js";

export async function merchantWalletGoogleRoutes(fastify) {
  fastify.post("/api/merchant/wallet/google/link", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const cardId = request.body?.cardId;

      if (!cardId) {
        return reply.code(400).send({ error: "cardId is required" });
      }

      const card = await Card.findOne({ _id: cardId, merchantId });
      if (!card) return reply.code(404).send({ error: "Card not found" });

      const { url, classId, objectId } = await createAddToWalletLinkForCard(cardId);

      return reply.send({ url, classId, objectId });
    } catch (err) {
      request.log?.error?.(err, "create add to wallet link failed");
      return reply.code(500).send({ error: err?.message || "Failed to create link" });
    }
  });

  fastify.post("/api/merchant/wallet/google/sync-class", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;

      const { classId } = await ensureLoyaltyClassForMerchant({
        merchantId,
        forcePatch: true,
      });

      return reply.send({ ok: true, classId });
    } catch (err) {
      request.log?.error?.(err, "sync wallet class failed");
      return reply.code(500).send({ error: err?.message || "Failed to sync class" });
    }
  });
}
