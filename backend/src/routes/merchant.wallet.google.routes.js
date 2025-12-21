import { getAuth } from "@clerk/fastify";
import { googleWalletConfig } from "../config/googleWallet.config.js";
import { Card } from "../models/card.model.js";
import {
  createAddToWalletLinkForCard,
  ensureLoyaltyClassForMerchant,
  ensureLoyaltyObjectForCard,
} from "../lib/googleWalletPass.js";

export async function merchantWalletGoogleRoutes(fastify) {
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      if (!body) return done(null, {});

      try {
        const json = JSON.parse(body);
        return done(null, json);
      } catch (err) {
        return done(err);
      }
    }
  );

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

      if (googleWalletConfig.isDevEnv && request.log && request.log.info) {
        request.log.info({ merchantId, classId }, "DEV wallet class sync requested");
      }

      return reply.send({ ok: true, classId });
    } catch (err) {
      request.log?.error?.(err, "sync wallet class failed");
      return reply.code(500).send({ error: err?.message || "Failed to sync class" });
    }
  });

  fastify.post("/api/merchant/wallet/google/sync-object", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const walletToken = String(request.body?.walletToken || "").trim();
      const cardId = String(request.body?.cardId || "").trim();

      if (!walletToken && !cardId) {
        return reply.code(400).send({ error: "walletToken or cardId is required" });
      }

      const cardQuery = walletToken
        ? { merchantId, walletToken }
        : { merchantId, _id: cardId };

      const card = await Card.findOne(cardQuery);
      if (!card) {
        return reply.code(404).send({ error: "Card not found" });
      }

      const { objectId, classId } = await ensureLoyaltyObjectForCard({
        card,
        forcePatch: true,
      });

      if (googleWalletConfig.isDevEnv && request.log && request.log.info) {
        request.log.info(
          { merchantId, cardId: card._id, objectId, classId },
          "DEV wallet object sync requested"
        );
      }

      return reply.send({ ok: true, objectId, classId });
    } catch (err) {
      request.log?.error?.(err, "sync wallet object failed");
      return reply.code(500).send({ error: err?.message || "Failed to sync object" });
    }
  });
}
