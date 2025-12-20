import { Card } from "../models/card.model.js";
import {
  buildAddToGoogleWalletUrl,
  ensureLoyaltyClassForMerchant,
  ensureLoyaltyObjectForCard,
} from "../lib/googleWalletPass.js";

export async function publicGoogleWalletRoutes(fastify) {
  // DEV/TEST: public Add-to-Google-Wallet by walletToken
  fastify.post("/api/public/wallet/google/link", async (request, reply) => {
    const walletToken = String(request.body?.walletToken || "").trim();

    if (!walletToken) {
      return reply.code(400).send({ error: "walletToken is required" });
    }

    const card = await Card.findOne({ walletToken });

    if (!card) {
      return reply.code(404).send({ error: "Card not found" });
    }

    try {
      const { classId } = await ensureLoyaltyClassForMerchant({
        merchantId: card.merchantId,
      });
      const { objectId } = await ensureLoyaltyObjectForCard({ card });
      const url = buildAddToGoogleWalletUrl({ classId, objectId });

      return reply.send({ url, classId, objectId });
    } catch (err) {
      request.log?.error?.(
        { err, walletToken, cardId: card?._id },
        "create public add to wallet link failed"
      );
      return reply.code(500).send({ error: "Google Wallet error" });
    }
  });
}
