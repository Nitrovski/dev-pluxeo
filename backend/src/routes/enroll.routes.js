import crypto from "crypto";
import { Customer } from "../models/customer.model.js";
import { Card } from "../models/card.model.js";

function generateWalletToken() {
  // dlouhý, URL-safe token, prakticky neuhodnutelný
  return crypto.randomBytes(24).toString("base64url");
}

export default async function enrollRoutes(fastify) {
  /**
   * POST /api/enroll
   * Public endpoint: zákazník naskenuje merchant QR a vytvorí se mu karta.
   * Body: { code: string }
   */
  fastify.post("/api/enroll", async (request, reply) => {
    try {
      const body = request.body || {};
      const code = (body.code || "").trim();

      if (!code) {
        return reply.code(400).send({ error: "code is required" });
      }

      // Najdi merchanta podle enrollment kódu
      const customer = await Customer.findOne({ "settings.enrollment.code": code });
      if (!customer) {
        return reply.code(404).send({ error: "Invalid enrollment code" });
      }

      const enrollment = customer.settings?.enrollment;
      if (!enrollment || enrollment.status !== "active") {
        return reply.code(403).send({ error: "Enrollment disabled" });
      }

      // vytvor kartu
      const walletToken = generateWalletToken();

      const card = await Card.create({
        merchantId: customer.merchantId,
        customerId: customer.customerId,
        walletToken,
        stamps: 0,
        rewards: 0,
        notes: "",
      });

      // MVP: design/template snapshot bereme z customers.settings.cardContent
      // (pokud pozdeji prejdete na CardTemplate kolekci, zmeníme jen tuhle cást)
      const cardContent = customer.settings?.cardContent || {};

      return reply.code(201).send({
        cardId: card._id,
        walletToken,
        merchantId: customer.merchantId,
        customerId: customer.customerId,
        merchantName: customer.name,
        cardContent,

        // wallet-ready placeholder (zatím false)
        wallet: {
          apple: { supported: false },
          google: { supported: false },
        },
      });
    } catch (err) {
      request.log.error(err, "Enroll error");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });
}
