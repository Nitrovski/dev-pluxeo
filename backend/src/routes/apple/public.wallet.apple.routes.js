import { Card } from "../../models/card.model.js";
import { CardTemplate } from "../../models/cardTemplate.model.js";
import { Merchant } from "../../models/merchant.model.js";
import { buildPublicCardPayload } from "../../lib/publicPayload.js";
import { buildApplePkpassBuffer } from "../../lib/apple/appleWallet.pass.js";
import { getAppleWalletConfig } from "../../lib/apple/appleWallet.config.js";

/**
 * Local test:
 * curl -X POST "http://localhost:3000/api/public/wallet/apple/link" \
 *   -H "Content-Type: application/json" \
 *   -d '{"walletToken":"<token>"}' --output test.pkpass
 */
export default async function publicAppleWalletRoutes(fastify) {
  fastify.post("/api/public/wallet/apple/link", async (request, reply) => {
    const maskWalletToken = (token) => {
      const safe = String(token || "").trim();
      if (!safe) return "";
      return `${safe.slice(0, 6)}***`;
    };

    const walletToken = String(request.body?.walletToken || "").trim();
    const walletTokenPrefix = maskWalletToken(walletToken);

    if (!walletToken) {
      request.log?.warn?.(
        { walletTokenPrefix },
        "[APPLE_WALLET] walletToken not provided"
      );
      return reply
        .code(400)
        .send({ ok: false, message: "walletToken is required" });
    }

    try {
      const card = await Card.findOne({ walletToken });

      request.log?.info?.(
        { cardId: card?._id ? String(card._id) : null, walletTokenPrefix },
        "[APPLE_WALLET] link request received"
      );

      if (!card) {
        request.log?.warn?.({ walletTokenPrefix }, "[APPLE_WALLET] card not found");
        return reply.code(404).send({ ok: false, message: "Card not found" });
      }

      const publicPayload = await buildPublicCardPayload(card._id);

      if (!publicPayload) {
        request.log?.warn?.(
          { cardId: String(card._id) },
          "[APPLE_WALLET] public payload missing"
        );
        return reply.code(404).send({ ok: false, message: "Card not found" });
      }

      // Load template + merchant using merchantId (Clerk user id string)
      const [template, merchant] = await Promise.all([
        CardTemplate.findOne({ merchantId: card.merchantId }).lean(),
        // IMPORTANT: card.merchantId is Clerk ID (e.g. "user_..."), not Mongo ObjectId
        Merchant.findOne({ merchantId: card.merchantId }).lean(),
      ]);

      if (!merchant) {
        request.log?.warn?.(
          { cardId: String(card._id), merchantId: String(card.merchantId) },
          "[APPLE_WALLET] merchant not found"
        );
        return reply.code(404).send({ ok: false, message: "Merchant not found" });
      }

      if (!publicPayload.redeemCode?.code && !Number.isFinite(publicPayload.stamps)) {
        request.log?.warn?.(
          { cardId: String(card._id) },
          "[APPLE_WALLET] public payload missing expected fields"
        );
      }

      const pkpassBuffer = await buildApplePkpassBuffer({
        card,
        publicPayload,
        walletToken,
        template,
        merchant,
        logger: request.log,
      });

      const cfg = getAppleWalletConfig({ logger: request.log });

      request.log?.info?.(
        {
          cardId: String(card._id),
          passTypeId: cfg.passTypeId,
          teamId: cfg.teamId,
        },
        "[APPLE_WALLET] pkpass generated"
      );

      reply
        .header("Content-Type", "application/vnd.apple.pkpass")
        .header(
          "Content-Disposition",
          `attachment; filename="pluxeo-${card._id}.pkpass"`
        );

      return reply.send(pkpassBuffer);
    } catch (err) {
      request.log?.error?.(
        { error: err?.message, stack: err?.stack },
        "[APPLE_WALLET] unhandled error"
      );
      return reply.code(500).send({ ok: false, message: "Apple Wallet error" });
    }
  });
}
