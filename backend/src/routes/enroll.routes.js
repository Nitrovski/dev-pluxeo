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
  fastify.post(
    "/api/enroll",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "5 minutes" },
      },
    },
    async (request, reply) => {
      try {
        const body = request.body || {};
        const code = String(body.code || "").trim();

        if (!code) {
          return reply.code(400).send({ error: "code is required" });
        }

        const ip = request.ip;
        const ua = request.headers["user-agent"] || "";

        // Najdi merchanta podle enrollment kódu
        const customer = await Customer.findOne({ "settings.enrollment.code": code });
        if (!customer) {
          // neprozrazuj víc info než je nutné
          request.log.warn({ ip, ua, code }, "Invalid enrollment code");
          return reply.code(404).send({ error: "Invalid enrollment code" });
        }

        const enrollment = customer.settings?.enrollment;
        if (!enrollment || enrollment.status !== "active") {
          request.log.warn({ ip, ua, merchantId: customer.merchantId }, "Enrollment disabled");
          return reply.code(403).send({ error: "Enrollment disabled" });
        }

        // MVP: design/template snapshot bereme z customers.settings.cardContent
        const cardContent = customer.settings?.cardContent || {};

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

        request.log.info(
          { ip, ua, merchantId: customer.merchantId, customerId: customer.customerId, cardId: card._id },
          "Enroll success"
        );

        return reply.code(201).send({
          cardId: card._id,
          walletToken,

          // (volitelne) pro FE
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
    }
  );
}
