import { getAuth } from "@clerk/fastify";
import { Card } from "../models/card.model.js";
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

      /**
       * 1) Najdi kartu pres redeemCodes.code
       *
       * DULEŽITÉ:
       * - Pokud už máš v DB historicky uložené kódy bez uppercasingu,
       *   tak exact match na `code` muže minout.
       *
       * Rešení bez refaktoru:
       * - použij case-insensitive regex (bezpecne escape), a rovnou filtruj active status.
       * - Jakmile budeš mít data normalizovaná, mužeš prepnout zpet na exact match.
       */
      const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const codeCi = new RegExp(`^${escaped}$`, "i");

      const card = await Card.findOne(
        {
          merchantId,
          redeemCodes: {
            $elemMatch: {
              code: codeCi,
              status: "active",
            },
          },
        },
        { redeemCodes: 1, merchantId: 1, customerId: 1, stamps: 1, rewards: 1 }
      );

      if (!card) {
        return reply.code(404).send({ error: "redeem code not found" });
      }

      // 2) Redeem (purpose reší interne reward/coupon)
      const redeemed = await redeemByCodeForMerchant(card, code, {
        source: "merchant_scan",
      });

      // 3) Updated public payload (vybere 1 aktivní redeem dle priority reward?coupon)
      const publicPayload = await buildPublicCardPayload(card._id);

      return reply.send({
        ok: true,
        redeemed: {
          code: redeemed.code,
          purpose: redeemed.purpose,
          redeemedAt: redeemed.redeemedAt,
        },
        card: {
          cardId: String(card._id),
          customerId: card.customerId,
          stamps: card.stamps,
          rewards: card.rewards,
        },
        public: publicPayload,
      });
    } catch (err) {
      // mapuj ocekávané chyby z redeem lib (409/410/404 atd.)
      const status = err?.statusCode || (err?.code === "ACTIVE_REDEEM_EXISTS" ? 409 : 500);
      return reply.code(status).send({ error: err?.message || "scan failed" });
    }
  });
}
