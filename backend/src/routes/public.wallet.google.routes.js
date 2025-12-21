import { Card } from "../models/card.model.js";
import {
  buildAddToGoogleWalletUrl,
  ensureLoyaltyClassForMerchant,
  ensureLoyaltyObjectForCard,
} from "../lib/googleWalletPass.js";
import {
  buildGoogleWalletErrorResponse,
  isGoogleWalletBadRequest,
  walletRequest,
} from "../lib/googleWalletClient.js";
import { googleWalletConfig } from "../config/googleWallet.config.js";

function trySendGoogleWalletBadRequest(reply, err) {
  if (!isGoogleWalletBadRequest(err)) return false;

  const errorPayload = buildGoogleWalletErrorResponse(err);
  reply.code(400).send(errorPayload);

  return true;
}

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

      if (googleWalletConfig.isDevEnv) {
        try {
          await walletRequest({
            method: "GET",
            path: `/walletobjects/v1/loyaltyClass/${classId}`,
          });

          await walletRequest({
            method: "GET",
            path: `/walletobjects/v1/loyaltyObject/${objectId}`,
          });
        } catch (verifyErr) {
          if (verifyErr?.status === 403 || verifyErr?.status === 404) {
            request.log?.error?.(
              { err: verifyErr, classId, objectId },
              "Google Wallet class/object not readable"
            );

            return reply.code(500).send({
              error: "Google Wallet class/object not readable",
              classId,
              objectId,
            });
          }

          throw verifyErr;
        }
      }
      const url = buildAddToGoogleWalletUrl({ classId, objectId });

      return reply.send({ url, classId, objectId });
    } catch (err) {
      request.log?.error?.(
        { err, walletToken, cardId: card?._id },
        "create public add to wallet link failed"
      );
      if (trySendGoogleWalletBadRequest(reply, err)) return;

      return reply.code(500).send({ error: "Google Wallet error" });
    }
  });
}
