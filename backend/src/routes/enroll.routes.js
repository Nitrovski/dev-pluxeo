import crypto from "crypto";
import { Customer } from "../models/customer.model.js";
import { Card } from "../models/card.model.js";
import { CardTemplate } from "../models/cardTemplate.model.js";

function generateWalletToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export default async function enrollRoutes(fastify) {
  /**
   * POST /api/enroll
   * Public endpoint: zákazník naskenuje merchant QR a vytvorí se mu karta.
   * Body: { code: string, clientId: string }
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
        const clientId = String(body.clientId || "").trim();

        if (!code) return reply.code(400).send({ error: "code is required" });
        if (!clientId) return reply.code(400).send({ error: "clientId is required" });

        const ip = request.ip;
        const ua = request.headers["user-agent"] || "";

        // Najdi merchanta podle enrollment kódu
        const customer = await Customer.findOne({ "settings.enrollment.code": code });
        if (!customer) {
          request.log.warn({ ip, ua }, "Invalid enrollment code");
          return reply.code(404).send({ error: "Invalid enrollment code" });
        }

        const enrollment = customer.settings?.enrollment;
        if (!enrollment || enrollment.status !== "active") {
          request.log.warn({ ip, ua, merchantId: customer.merchantId }, "Enrollment disabled");
          return reply.code(403).send({ error: "Enrollment disabled" });
        }

        // MVP: content snapshot zatím bereme z customers.settings.cardContent
        const cardContent = customer.settings?.cardContent || {};

        // ? nacti aktuální template (zdroj pravdy pro program)
        const template = await CardTemplate.findOne({ merchantId: customer.merchantId }).lean();

        const programType =
          template?.programType || template?.cardType || "stamps"; // backward compatible

        const stampsPerReward =
          template?.rules?.freeStampsToReward != null
            ? Number(template.rules.freeStampsToReward)
            : 10;

        // 1) idempotence: pokud už karta pro tohle zarízení existuje, vrat ji
        const existing = await Card.findOne({ merchantId: customer.merchantId, clientId });
        if (existing) {
          request.log.info(
            { ip, ua, merchantId: customer.merchantId, clientId, cardId: existing._id },
            "Enroll idempotent hit"
          );

          return reply.code(200).send({
            cardId: existing._id,
            walletToken: existing.walletToken,
            merchantName: customer.name,
            cardContent,
            wallet: {
              apple: { supported: false },
              google: { supported: false },
            },
          });
        }

        // 2) vytvor novou kartu
        try {
          const walletToken = generateWalletToken();

          const cardDoc = {
            merchantId: customer.merchantId,
            customerId: customer.customerId,
            clientId,
            walletToken,
            stamps: 0,
            rewards: 0,
            notes: "",

            // ? nový programový typ na karte (tohle ti dnes chybí)
            type: programType,

            // ? stamps pravidlo pouze pokud je stamps program
            stampsPerReward: programType === "stamps" ? stampsPerReward : undefined,
          };

          const card = await Card.create(cardDoc);

          request.log.info(
            {
              ip,
              ua,
              merchantId: customer.merchantId,
              customerId: customer.customerId,
              clientId,
              cardId: card._id,
              type: programType,
            },
            "Enroll success"
          );

          return reply.code(201).send({
            cardId: card._id,
            walletToken,
            merchantName: customer.name,
            cardContent,
            wallet: {
              apple: { supported: false },
              google: { supported: false },
            },
          });
        } catch (err) {
          // race condition: pokud to paralelne vytvoril jiný request, docti a vrat
          if (err?.code === 11000) {
            const card = await Card.findOne({ merchantId: customer.merchantId, clientId });
            if (card) {
              request.log.info(
                { ip, ua, merchantId: customer.merchantId, clientId, cardId: card._id },
                "Enroll race resolved"
              );

              return reply.code(200).send({
                cardId: card._id,
                walletToken: card.walletToken,
                merchantName: customer.name,
                cardContent,
                wallet: {
                  apple: { supported: false },
                  google: { supported: false },
                },
              });
            }
          }
          throw err;
        }
      } catch (err) {
        request.log.error(err, "Enroll error");
        return reply.code(500).send({ error: "Internal server error" });
      }
    }
  );
}
