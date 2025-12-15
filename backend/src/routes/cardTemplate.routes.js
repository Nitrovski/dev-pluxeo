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

      // když není, vrátíme default (v API tvaru)
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
              rules: { freeStampsToReward: 10, couponText: "" },
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

      // ? whitelist presne podle FE tvaru
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

        // rules mapujeme správne pod rules.*
        rules: {
          freeStampsToReward: payload.freeStampsToReward,
          couponText: payload.couponText,
        },
      };

      // ocisti undefined (a u rules nech jen co prišlo)
      const $set = { merchantId };
      for (const [k, v] of Object.entries(update)) {
        if (v === undefined) continue;
        if (k === "rules") {
          const rules = {};
          if (v.freeStampsToReward !== undefined)
            rules.freeStampsToReward = pickNumber(v.freeStampsToReward, 10);
          if (v.couponText !== undefined)
            rules.couponText = pickString(v.couponText, "");
          if (Object.keys(rules).length > 0) $set.rules = rules;
        } else if (k === "programType") {
          $set.programType = v === "coupon" ? "coupon" : "stamps";
        } else if (k === "logoUrl") {
          // FE posílá "" nebo url ? v DB muže být ""
          $set.logoUrl = pickString(v, "");
        } else if (typeof v === "string") {
          $set[k] = v;
        } else {
          $set[k] = v;
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
