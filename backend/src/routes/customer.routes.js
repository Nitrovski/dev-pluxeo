// src/routes/customer.routes.js
import { Customer } from "../models/customer.model.js";
import { getAuth } from "@clerk/fastify";

/**
 * CardContent normalizace (aby FE Zod schema vždy prošla)
 * - texty vždy string
 * - barvy vždy string
 * - themeVariant vždy enum
 */
const DEFAULT_CARD_CONTENT = {
  headline: "",
  subheadline: "",
  openingHours: "",
  customMessage: "",
  websiteUrl: "",

  themeVariant: "classic", // "classic" | "stamps" | "minimal"
  primaryColor: "#FF9900",
  secondaryColor: "#111111",
};

function normalizeCardContent(input = {}) {
  const out = { ...DEFAULT_CARD_CONTENT, ...(input || {}) };

  const allowed = new Set(["classic", "stamps", "minimal"]);
  if (!allowed.has(out.themeVariant)) out.themeVariant = DEFAULT_CARD_CONTENT.themeVariant;

  out.primaryColor = typeof out.primaryColor === "string" ? out.primaryColor : DEFAULT_CARD_CONTENT.primaryColor;
  out.secondaryColor = typeof out.secondaryColor === "string" ? out.secondaryColor : DEFAULT_CARD_CONTENT.secondaryColor;

  for (const k of ["headline", "subheadline", "openingHours", "customMessage", "websiteUrl"]) {
    out[k] = typeof out[k] === "string" ? out[k] : "";
  }

  return out;
}

function isEmptyObject(x) {
  return x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === 0;
}

async function customerRoutes(fastify, options) {
  /**
   * POST /api/customers
   * Vytvorení nového zákazníka (provozovny) pro prihlášeného merchanta
   */
  fastify.post("/api/customers", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);
      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const body = request.body || {};

      // vynutíme merchantId ze session (ne z body)
      const doc = {
        ...body,
        merchantId,
        // aby cardContent nebylo rozbité už pri create
        cardContent: normalizeCardContent(body.cardContent || {}),
      };

      const customer = await Customer.create(doc);
      return reply.code(201).send(customer);
    } catch (err) {
      request.log.error(err, "Error creating customer");

      if (err.code === 11000) {
        return reply
          .code(409)
          .send({ error: "Customer with this customerId already exists" });
      }

      return reply.code(500).send({ error: "Error creating customer" });
    }
  });

  /**
   * GET /api/customers/:customerId
   * Získání zákazníka podle customerId (jen pro prihlášeného merchanta a jeho customer)
   */
  fastify.get("/api/customers/:customerId", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);
      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const { customerId } = request.params;

      const customer = await Customer.findOne({ customerId, merchantId }).lean();
      if (!customer) {
        return reply.code(404).send({ error: "Customer not found" });
      }

      return reply.send(customer);
    } catch (err) {
      request.log.error(err, "Error fetching customer");
      return reply.code(500).send({ error: "Error fetching customer" });
    }
  });

  /**
   * GET /api/customers/:customerId/card-content
   * Vrátí pouze obsah/šablonu karty (pro šablonovací stránku)
   * ?? pouze prihlášený merchant a jen jeho customer.
   *
   * Pokud ješte není nic nastavené -> 404 (FE použije defaulty)
   */
  fastify.get("/api/customers/:customerId/card-content", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);
      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const { customerId } = request.params;

      const customer = await Customer.findOne({ customerId, merchantId }).lean();
      if (!customer) {
        return reply.code(404).send({ error: "Customer not found" });
      }

      const cc = customer.cardContent;

      // pokud je null / {} -> 404 (FE fallback)
      if (!cc || isEmptyObject(cc)) {
        return reply.code(404).send({ error: "Card content not found" });
      }

      const normalized = normalizeCardContent(cc);

      // prubežne opravíme DB (at se už nevrací nevalidní veci)
      await Customer.updateOne(
        { customerId, merchantId },
        { $set: { cardContent: normalized } }
      );

      return reply.send(normalized);
    } catch (err) {
      request.log.error(err, "Error fetching card content");
      return reply.code(500).send({ error: "Error fetching card content" });
    }
  });

  /**
   * PATCH /api/customers/:customerId/card-content
   * Uloží / updatuje obsah karty (šablona)
   * ?? pouze prihlášený merchant a jen jeho customer.
   */
  fastify.patch("/api/customers/:customerId/card-content", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);
      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const { customerId } = request.params;
      const payload = request.body || {};

      // sloucíme existující a nové + normalizujeme
      const customer = await Customer.findOne({ customerId, merchantId });
      if (!customer) {
        return reply.code(404).send({ error: "Customer not found" });
      }

      const existing = customer.cardContent && typeof customer.cardContent === "object"
        ? customer.cardContent
        : {};

      const merged = {
        ...existing,
        ...payload,
        lastUpdatedAt: new Date(),
      };

      customer.cardContent = normalizeCardContent(merged);

      await customer.save();

      return reply.send(customer.cardContent);
    } catch (err) {
      request.log.error(err, "Error updating card content");
      return reply.code(500).send({ error: "Error updating card content" });
    }
  });
}

export default customerRoutes;
