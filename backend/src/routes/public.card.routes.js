import { Card } from "../models/card.model.js";
import { buildPublicCardPayload } from "../lib/publicPayload.js";
import { pickRedeemForDisplay } from "../lib/redeemCodes.js";

export async function publicCardRoutes(fastify) {
  // Public (bez auth) – slouží jen k zobrazení webové karty
  fastify.get("/api/public/card/:walletToken", async (request, reply) => {
    const walletToken = String(request.params.walletToken || "").trim();
    if (!walletToken) return reply.code(400).send({ error: "walletToken is required" });

    const card = await Card.findOne({ walletToken });
    if (!card) return reply.code(404).send({ error: "card not found" });

    // Tvuj existující public payload (template + stamps/rewards atd.)
    const payload = await buildPublicCardPayload(card._id);

    // QR hodnota: redeem má prioritu, jinak stamping token
    const redeem = pickRedeemForDisplay(card);
    const qrValue = redeem?.code || card.walletToken;

    return reply.send({
      ...payload,
      qr: {
        value: qrValue,
        kind: redeem ? `redeem:${redeem.purpose}` : "stamp",
      },
    });
  });
}
