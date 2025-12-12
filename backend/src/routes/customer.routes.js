// src/routes/customer.routes.js
import { Customer } from "../models/customer.model.js";
import { getAuth } from "@clerk/fastify";
import crypto from "crypto";

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

  out.primaryColor =
    typeof out.primaryColor === "string" ? out.primaryColor : DEFAULT_CARD_CONTENT.primaryColor;
  out.secondaryColor =
    typeof out.secondaryColor === "string" ? out.secondaryColor : DEFAULT_CARD_CONTENT.secondaryColor;

  for (const k of ["headline", "subheadline", "openingHours", "customMessage", "websiteUrl"]) {
    out[k] = typeof out[k] === "string" ? out[k] : "";
  }

  return out;
}

function isEmptyObject(x) {
  return x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === 0;
}

function coercePositiveInt(value, fallback = 10) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.floor(n);
  return rounded > 0 ? rounded : fallback;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .slice(0, 40);
}

function trimOrEmpty(v) {
  return typeof v === "string" ? v.trim() : "";
}
function trimOrNull(v) {
  const s = trimOrEmpty(v);
  return s ? s : null;
}

async function customerRoutes(fastify, options) {
  /**
   * POST /api/onboarding
   * Uloží onboarding údaje podniku.
   * - name: required
   * - phone/ico/address: optional
   * Vytvorí Customer pro daného merchanta, pokud neexistuje.
   */
  fastify.post("/api/onboarding", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);
      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const body = request.body || {};

      const name = trimOrEmpty(body.name);
      if (!name) {
        return reply.code(400).send({ error: "name is required" });
      }

      const email = trimOrNull(body.email);
      const phone = trimOrNull(body.phone);
      const ico = trimOrNull(body.ico);
      const address = trimOrEmpty(body.address); // adresa muže být i prázdný string

      let customer = await Customer.findOne({ merchantId });

      if (!customer) {
        const base = slugify(name) || "merchant";
        const customerId = `${base}-${crypto.randomBytes(3).toString("hex")}`;

        customer = await Customer.create({
          merchantId,
          customerId,
          name,
          email,
          phone,
          ico,
          address,
          onboardingCompleted: true,
          settings: { freeStampsToReward: 10 },
          cardContent: normalizeCardContent({}),
        });
      } else {
        customer.name = name;
        if (email !== null) customer.email = email;
        if (phone !== null) customer.phone = phone;
        if (ico !== null) customer.ico = ico;
        if (typeof body.address === "string") customer.address = address; // update jen když prišlo
        customer.onboardingCompleted = true;

        await customer.save();
      }

      return reply.send({
        merchantId,
        customerId: customer.customerId,
        customerName: customer.name ?? null,
      });
    } catch (err) {
      request.log.error(err, "Error in /api/onboarding");
      return reply.code(500).send({ error: "Error in /api/onboarding" });
    }
  });

  /**
   * POST /api/customers/ensure
   * Idempotentne vrátí customerId pro prihlášeného merchanta.
   * ?Už NEvytvárí "My Business" – vytvorení reší onboarding.
   */
  fastify.post("/api/customers/ensure", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);
      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;
      const existing = await Customer.findOne({ merchantId }).lean();

      if (!existing) {
        return reply.code(404).send({ error: "Customer not found - run onboarding" });
      }

      return reply.send({
        customerId: existing.customerId,
        customerName: existing.name ?? null,
      });
    } catch (err) {
      request.log.error(err, "Error ensuring customer");
      return reply.code(500).send({ error: "Error ensuring customer" });
    }
  });

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

      if (!body.customerId || typeof body.customerId !== "string") {
        return reply.code(400).send({ error: "customerId is required" });
      }
      if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
        return reply.code(400).send({ error: "name is required" });
      }

      const freeStampsToReward = coercePositiveInt(
        body.freeStampsToReward ?? body?.settings?.freeStampsToReward,
        10
      );

      const doc = {
        customerId: body.customerId.trim(),
        merchantId,

        name: trimOrEmpty(body.name),
        email: trimOrNull(body.email),
        address: trimOrEmpty(body.address),
        phone: trimOrNull(body.phone),
        ico: trimOrNull(body.ico),

        settings: {
          ...(body.settings || {}),
          freeStampsToReward,
        },

        // ? cardContent bereme jen z body.cardContent
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
   * Pokud ješte není nic nastavené -> 404 (FE použije defaulty)
   * Kompatibilita s FE: vrací i freeStampsToReward (z settings)
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
      if (!cc || isEmptyObject(cc)) {
        return reply.code(404).send({ error: "Card content not found" });
      }

      const normalized = normalizeCardContent(cc);

      await Customer.updateOne(
        { customerId, merchantId },
        { $set: { cardContent: normalized } }
      );

      const freeStampsToReward = coercePositiveInt(customer?.settings?.freeStampsToReward, 10);

      return reply.send({
        ...normalized,
        freeStampsToReward,
      });
    } catch (err) {
      request.log.error(err, "Error fetching card content");
      return reply.code(500).send({ error: "Error fetching card content" });
    }
  });

  /**
   * PATCH /api/customers/:customerId/card-content
   * Uloží / updatuje obsah karty (šablona)
   * Kompatibilita s FE: freeStampsToReward z payloadu uložíme do settings
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

      const customer = await Customer.findOne({ customerId, merchantId });
      if (!customer) {
        return reply.code(404).send({ error: "Customer not found" });
      }

      if (payload.freeStampsToReward !== undefined) {
        const n = coercePositiveInt(payload.freeStampsToReward, 10);
        customer.settings = customer.settings || {};
        customer.settings.freeStampsToReward = n;
      }

      const { freeStampsToReward, ...rest } = payload;

      const existing =
        customer.cardContent && typeof customer.cardContent === "object"
          ? customer.cardContent
          : {};

      const merged = {
        ...existing,
        ...rest,
        lastUpdatedAt: new Date(),
      };

      customer.cardContent = normalizeCardContent(merged);

      await customer.save();

      const safeThreshold = coercePositiveInt(customer?.settings?.freeStampsToReward, 10);

      return reply.send({
        ...customer.cardContent,
        freeStampsToReward: safeThreshold,
      });
    } catch (err) {
      request.log.error(err, "Error updating card content");
      return reply.code(500).send({ error: "Error updating card content" });
    }
  });
}

export default customerRoutes;
