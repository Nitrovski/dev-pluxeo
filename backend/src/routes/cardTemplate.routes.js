import { CardTemplate } from "../models/cardTemplate.model.js";
import { getAuth } from "@clerk/fastify";

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

      let template = await CardTemplate.findOne({ merchantId }).lean();

      // Pokud šablona ješte neexistuje ? vrátíme default hodnoty
      if (!template) {
        template = {
          merchantId,
          programName: "",
          headline: "",
          subheadline: "",
          customMessage: "",
          openingHours: "",
          websiteUrl: "",
          freeStampsToReward: 10,
          themeVariant: "classic",
          primaryColor: "#FF9900",
          secondaryColor: "#111827",
          logoUrl: "",
        };
      }

      return reply.send(template);
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

      // Povolená pole (aby si obchodník nemohl poslat neco jiného)
      const fields = [
        "programName",
        "headline",
        "subheadline",
        "customMessage",
        "openingHours",
        "websiteUrl",
        "freeStampsToReward",
        "themeVariant",
        "primaryColor",
        "secondaryColor",
        "logoUrl",
      ];

      const update = {};
      for (const key of fields) {
        if (payload[key] !== undefined) {
          update[key] = payload[key];
        }
      }

      // Upsert = pokud neexistuje ? vytvorí, pokud existuje ? upraví
      const template = await CardTemplate.findOneAndUpdate(
        { merchantId },
        { $set: update, merchantId },
        { new: true, upsert: true }
      );

      return reply.send(template);
    } catch (err) {
      request.log.error(err, "Error updating card template");
      return reply.code(500).send({ error: "Error updating card template" });
    }
  });
}

export default cardTemplateRoutes;
