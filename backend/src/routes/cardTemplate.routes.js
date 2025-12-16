import { CardTemplate } from "../models/cardTemplate.model.js";
import { getAuth } from "@clerk/fastify";

function pickString(v, fallback = "") {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function pickNumber(v, fallback) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toApi(template, merchantId) {
  // vracíme tvar, který FE ocekává (CardTemplatePage)
  return {
    merchantId,

    programType: template?.programType || "stamps",
    programName: template?.programName || "",
    headline: template?.headline || "",
    subheadline: template?.subheadline || "",
    customMessage: template?.customMessage || "",
    openingHours: template?.openingHours || "",
    websiteUrl: template?.websiteUrl || "",

    // ?? pravidla programu
    freeStampsToReward: template?.rules?.freeStampsToReward ?? 10,
    couponText: template?.rules?.couponText ?? "",

    primaryColor: template?.primaryColor || "#FF9900",
    secondaryColor: template?.secondaryColor || "#111827",
    logoUrl: template?.logoUrl || "",
  };
}

async function cardTemplateRoutes(fastify, options) {
  /**
   * GET /api/card-template
   * Vrátí šablonu karty pro prihlášeného merchanta
   */
  fastify.get("/api/card-template", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;

      const template = await CardTemplate.findOne({ merchantId }).lean();

      // pokud šablona neexistuje ? vrátíme default
      if (!template) {
        return reply.send(
          toApi(
            {
              programType: "stamps",
              programName: "",
              headline: "",
              subheadline: "",
              customMessage: "",
              openingHours: "",
              websiteUrl: "",
              rules: {
                freeStampsToReward: 10,
                couponText: "",
              },
              primaryColor: "#FF9900",
              secondaryColor: "#111827",
              logoUrl: "",
            },
            merchantId
          )
        );
      }

      return reply.send(toApi(template, merchantId));
    } catch (err) {
      request.log.error(err, "Error fetching card template");
      return reply.code(500).send({ error: "Error fetching card template" });
    }
  });

  /**
   * PUT /api/card-template
   * Uloží / aktualizuje šablonu karty pro merchanta
   */
  fastify.put("/api/card-template", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const payload = request.body || {};

      // whitelist presne podle FE tvaru
      const update = {
        programType: payload.programType, // "stamps" | "coupon"
        programName: payload.programName,
        headline: payload.headline,
        subheadline: payload.subheadline,
        customMessage: payload.customMessage,
        openingHours: payload.openingHours,
        websiteUrl: payload.websiteUrl,
        primaryColor: payload.primaryColor,
        secondaryColor: payload.secondaryColor,
        logoUrl: payload.logoUrl,

        rules: {
          freeStampsToReward: payload.freeStampsToReward,
          couponText: payload.couponText,
        },
      };

      // vycisti undefined hodnoty
      const $set = { merchantId };

      for (const [key, value] of Object.entries(update)) {
        if (value === undefined) continue;

        if (key === "rules") {
          const rules = {};
          if (value.freeStampsToReward !== undefined) {
            rules.freeStampsToReward = pickNumber(
              value.freeStampsToReward,
              10
            );
          }
          if (value.couponText !== undefined) {
            rules.couponText = pickString(value.couponText, "");
          }
          if (Object.keys(rules).length > 0) {
            $set.rules = rules;
          }
        } else if (key === "programType") {
          $set.programType = value === "coupon" ? "coupon" : "stamps";
        } else if (key === "logoUrl") {
          $set.logoUrl = pickString(value, "");
        } else if (typeof value === "string") {
          $set[key] = value;
        } else {
          $set[key] = value;
        }
      }

      const template = await CardTemplate.findOneAndUpdate(
        { merchantId },
        { $set },
        { new: true, upsert: true }
      ).lean();

      return reply.send(toApi(template, merchantId));
    } catch (err) {
      request.log.error(err, "Error updating card template");
      return reply.code(500).send({ error: "Error updating card template" });
    }
  });
}

export default cardTemplateRoutes;
