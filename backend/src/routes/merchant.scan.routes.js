import { getAuth } from "@clerk/fastify";
import { Card } from "../models/card.model.js";
import { CardEvent } from "../models/cardEvent.model.js";
import { redeemByCodeForMerchant } from "../lib/redeemCodes.js";
import { buildPublicCardPayload } from "../lib/publicPayload.js";

function normCode(v) {
  return String(v || "").trim().toUpperCase();
}

export async function merchantScanRoutes(fastify) {
  fastify.post("/api/merchant/scan", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);
      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const code = normCode(request.body?.code);

      if (!code) {
        return reply.code(400).send({ error: "code is required" });
      }

      // 1) Redeem podle kódu (helper najde kartu a vyreší reward/coupon + eventy)
      const res = await redeemByCodeForMerchant({
        Card,
        CardEvent,
        merchantId,
        code,
        source: "merchant_scan",
        actorId: merchantId,
      });

      if (!res.ok) {
        return reply.code(res.status).send({ error: res.error });
      }

      const updatedCard = res.card; // už po redeemu

      // 2) Updated public payload (vybere 1 aktivní redeem dle priority reward?coupon)
      const publicPayload = await buildPublicCardPayload(String(updatedCard._id));

      return reply.send({
        ok: true,
        redeemed: {
          code,
          purpose: res.purpose,
          redeemedAt: new Date().toISOString(), // nebo si to vytáhni z card.redeemCodes (viz níž)
        },
        card: {
          cardId: String(updatedCard._id),
          customerId: updatedCard.customerId ?? null,
          stamps: updatedCard.stamps ?? 0,
          rewards: updatedCard.rewards ?? 0,
        },
        public: publicPayload,
      });
    } catch (err) {
      request.log.error(err, "merchant scan failed");
      return reply.code(500).send({ error: "scan failed" });
    }
  });
}
