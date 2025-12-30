import crypto from "crypto";
import { Customer } from "../models/customer.model.js";
import { Card } from "../models/card.model.js";
import { CardTemplate } from "../models/cardTemplate.model.js";
import { CardEvent } from "../models/cardEvent.model.js";
import { buildCardEventPayload } from "../lib/eventSchemas.js";
import { generateScanCode, ensureCardHasScanCode } from "../lib/scanCode.js";
import { ensureGooglePassForCard } from "../lib/googleWalletPass.js";

const normalizeEnrollmentCode = (value) => String(value || "").trim().toLowerCase();
const normalizeClientId = (value) => String(value || "").trim().toLowerCase();

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildEnrollSuccessPayload({
  card,
  customer,
  cardContent,
  resolvedPassType,
  alreadyExists,
}) {
  return {
    ok: true,
    alreadyExists,
    cardId: card._id,
    walletToken: card.walletToken,
    merchantName: customer.name,
    cardContent,
    passTypeIssued: resolvedPassType,
    wallet: {
      apple: { supported: false },
      google: { supported: false },
    },
  };
}

function generateWalletToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export default async function enrollRoutes(fastify) {
  /**
   * POST /api/enroll
   * Public endpoint: zákazník naskenuje merchant QR a vytvorí se mu karta.
   * Body: { code: string, clientId?: string }
   */
  fastify.post(
    "/api/enroll",
    {
      config: {
        rateLimit: { max: 20, timeWindow: "5 minutes" },
      },
    },
    async (request, reply) => {
      let logContextBase = {};
      try {
        const body = request.body || {};
        const enrollmentCode = normalizeEnrollmentCode(body.code);
        const normalizedClientId = normalizeClientId(body.clientId);

        const effectiveClientId =
          normalizedClientId || `temp-${crypto.randomBytes(8).toString("hex")}`;

        const requestId = request.id;
        const ip = request.ip;
        const ua = request.headers["user-agent"] || "";

        logContextBase = (() => {
          try {
            return {
              requestId,
              ip,
              ua,
              enrollmentCode,
              clientId: normalizedClientId || null,
              effectiveClientId,
            };
          } catch {
            return {};
          }
        })();

        if (!enrollmentCode) {
          const payload = { ok: false, error: "code is required" };
          request.log.warn({ ...logContextBase, statusCode: 400, payload }, "Enroll invalid input");
          return reply.code(400).send(payload);
        }

        // Najdi merchanta podle enrollment kódu
        const customer = await Customer.findOne({
          $expr: {
            $eq: [
              { $toLower: "$settings.enrollment.code" },
              enrollmentCode,
            ],
          },
        });
        if (!customer) {
          const payload = { ok: false, error: "Invalid enrollment code" };
          request.log.warn(
            { ...logContextBase, statusCode: 404, payload },
            "Invalid enrollment code"
          );
          return reply.code(404).send(payload);
        }

        const enrollment = customer.settings?.enrollment;
        if (!enrollment || enrollment.status !== "active") {
          const payload = { ok: false, error: "Enrollment disabled" };
          request.log.warn(
            {
              ...logContextBase,
              merchantId: customer.merchantId,
              statusCode: 403,
              payload,
            },
            "Enrollment disabled"
          );
          return reply.code(403).send(payload);
        }

        const logContext = {
          ...logContextBase,
          merchantId: customer.merchantId,
          customerId: customer.customerId,
        };

        // MVP: content snapshot zatím bereme z customers.settings.cardContent
        const cardContent = customer.settings?.cardContent || {};

        // ? nacti aktuální template (zdroj pravdy pro program)
        const template = await CardTemplate.findOne({ merchantId: customer.merchantId }).lean();

        const programType =
          template?.programType || template?.cardType || "stamps"; // backward compatible

        const walletGoogle = template?.wallet?.google || {};
        const resolvedPassType =
          walletGoogle.passType === "generic" &&
          walletGoogle.genericConfig?.enabled === true
            ? "generic"
            : "loyalty";

        const stampsPerReward =
          template?.rules?.freeStampsToReward != null
            ? Number(template.rules.freeStampsToReward)
            : 10;

        // 1) idempotence: pokud u karta pro tohle zarízení existuje, vrat ji
        const existing =
          normalizedClientId
            ? await Card.findOne({
                merchantId: customer.merchantId,
                clientId: new RegExp(`^${escapeRegex(normalizedClientId)}$`, "i"),
              })
            : null;

        const existingByCustomer =
          existing || !customer.customerId
            ? existing
            : await Card.findOne({
                merchantId: customer.merchantId,
                customerId: customer.customerId,
              });

        const resolvedExisting = existing || existingByCustomer;

        if (resolvedExisting) {
          await ensureCardHasScanCode(resolvedExisting);

          const payload = buildEnrollSuccessPayload({
            card: resolvedExisting,
            customer,
            cardContent,
            resolvedPassType,
            alreadyExists: true,
          });

          request.log.info(
            { ...logContext, cardId: resolvedExisting._id, payload },
            "Enroll idempotent hit"
          );

          return reply.code(200).send(payload);
        }

        // 2) vytvor novou kartu
        try {
          const walletToken = generateWalletToken();

          const cardDoc = {
            merchantId: customer.merchantId,
            customerId: customer.customerId,
            clientId: effectiveClientId,
            walletToken,
            scanCode: generateScanCode(),
            stamps: 0,
            rewards: 0,
            notes: "",

            // ? nový programový typ na karte (tohle ti dnes chybí)
            type: programType,

            googleWallet: {
              passType: resolvedPassType,
            },

            // ? stamps pravidlo pouze pokud je stamps program
            stampsPerReward: programType === "stamps" ? stampsPerReward : undefined,
          };

          const card = await Card.create(cardDoc);

          await ensureGooglePassForCard({
            merchantId: customer.merchantId,
            cardId: card._id,
          });

          await CardEvent.create(
            buildCardEventPayload({
              merchantId: customer.merchantId,
              cardId: card._id,
              walletToken: card.walletToken,
              type: "CARD_CREATED",
              cardType: card.type ?? "stamps",
              templateId: card.templateId ?? null,
              actor: { type: "system", source: "public-enroll" },
              payload: {
                customerId: customer.customerId,
                clientId: effectiveClientId,
              },
            })
          );

          const payload = buildEnrollSuccessPayload({
            card,
            customer,
            cardContent,
            resolvedPassType,
            alreadyExists: false,
          });

          request.log.info(
            { ...logContext, cardId: card._id, payload, type: programType },
            "Enroll success"
          );

          return reply.code(200).send(payload);
        } catch (err) {
          // race condition: pokud to paralelne vytvoril jiný request, docti a vrat
          if (err?.code === 11000) {
            const card = await Card.findOne({
              merchantId: customer.merchantId,
              clientId: effectiveClientId,
            });
            if (card) {
              await ensureCardHasScanCode(card);

              const payload = buildEnrollSuccessPayload({
                card,
                customer,
                cardContent,
                resolvedPassType,
                alreadyExists: true,
              });

              request.log.info(
                { ...logContext, cardId: card._id, payload },
                "Enroll race resolved"
              );

              return reply.code(200).send(payload);
            }
          }
          throw err;
        }
      } catch (err) {
        const payload = { ok: false, error: "Internal server error" };
        request.log.error({ err, ...logContextBase, payload }, "Enroll error");
        return reply.code(500).send(payload);
      }
    }
  );
}
