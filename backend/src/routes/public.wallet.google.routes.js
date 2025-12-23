import { Card } from "../models/card.model.js";
import { createAddToWalletLinkForCard } from "../lib/googleWalletPass.js";
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
  const handlePublicWalletLink = async (request, reply) => {
    const walletTokenSource =
      request.method === "GET" ? request.query?.walletToken : request.body?.walletToken;
    const walletToken = String(walletTokenSource || "").trim();

    if (!walletToken) {
      return reply.code(400).send({ error: "walletToken is required" });
    }

    const card = await Card.findOne({ walletToken });

    if (!card) {
      return reply.code(404).send({ error: "Card not found" });
    }

    try {
      const { url, classId, objectId, passType } = await createAddToWalletLinkForCard(
        card._id,
        { logger: request.log }
      );

      const payloadKey = passType === "generic" ? "genericObjects" : "loyaltyObjects";

      if (googleWalletConfig.isDevEnv) {
        try {
          await walletRequest({
            method: "GET",
            path: `/walletobjects/v1/${passType}Class/${classId}`,
          });

          await walletRequest({
            method: "GET",
            path: `/walletobjects/v1/${passType}Object/${objectId}`,
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
      request.log?.info?.(
        {
          walletToken,
          cardId: card._id,
          passType,
          classId,
          objectId,
          payloadKey,
        },
        "public google wallet link generated"
      );

      const response = { url, classId, objectId, passType };

      if (googleWalletConfig.isDevEnv) {
        response.debug = {
          effectivePassType: passType,
          classId,
          objectId,
          payloadKey,
        };
      }

      return reply.send(response);
    } catch (err) {
      request.log?.error?.(
        { err, walletToken, cardId: card?._id },
        "create public add to wallet link failed"
      );
      if (err?.message === "Google Wallet credentials missing private_key/private_key_id") {
        return reply.code(500).send({ error: err.message });
      }
      if (trySendGoogleWalletBadRequest(reply, err)) return;

      return reply.code(500).send({ error: "Google Wallet error" });
    }
  };

  // DEV/TEST: public Add-to-Google-Wallet by walletToken
  fastify.get("/api/public/wallet/google/link", handlePublicWalletLink);
  fastify.post("/api/public/wallet/google/link", handlePublicWalletLink);
}
