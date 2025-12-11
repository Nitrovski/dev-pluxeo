// src/routes/card.routes.js
import { Card } from "../models/card.model.js";
import { Customer } from "../models/customer.model.js";
import { getAuth } from "@clerk/fastify";
import crypto from "crypto";

async function cardRoutes(fastify, options) {
  /**
   * POST /api/cards
   * Vytvoří novou kartu pro PŘIHLÁŠENÉHO merchanta
   */
  fastify.post("/api/cards", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;

      const payload = request.body || {};
      const { customerId, walletToken: incomingWalletToken, ...rest } = payload;

      const walletToken =
        incomingWalletToken || crypto.randomUUID().replace(/-/g, "");

      const card = await Card.create({
        ...rest,
        merchantId,
        customerId,
        walletToken,
      });

      return reply.code(201).send(card);
    } catch (err) {
      request.log.error({ err, body: request.body }, "Error creating card");

      if (err.code === 11000) {
        return reply
          .code(409)
          .send({ error: "Card with this walletToken already exists" });
      }

      return reply.code(500).send({
        error: "Error creating card",
        message: err.message,
        name: err.name,
        stack: err.stack,
      });
    }
  });

  /**
   * GET /api/cards
   * Vrátí všechny karty aktuálního merchanta
   */
  fastify.get("/api/cards", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const merchantId = userId;

      const cards = await Card.find({ merchantId }).lean();
      return reply.send(cards);
    } catch (err) {
      request.log.error(err, "Error fetching cards");
      return reply.code(500).send({ error: "Error fetching cards" });
    }
  });

  /**
   * GET /api/cards/:id
   * Vrátí detail karty podle ID (plná data) – jen když patří danému merchantovi
   */
  fastify.get("/api/cards/:id", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const { id } = request.params;
      const merchantId = userId;

      const card = await Card.findOne({ _id: id, merchantId });
      if (!card) {
        return reply.code(404).send({ error: "Card not found" });
      }

      return reply.send(card);
    } catch (err) {
      request.log.error(err, "Error fetching card");
      return reply.code(500).send({ error: "Error fetching card" });
    }
  });


  /**
   * POST /api/cards/:id/stamp
   * Přidá razítko (default +1, nebo podle body.amount)
   * a přepočítá rewards podle prahu z Customer.settings.freeStampsToReward.
   * ������ Pouze pro přihlášeného merchanta a jen na jeho kartě.
   */
  fastify.post("/api/cards/:id/stamp", async (request, reply) => {
    try {
      const { isAuthenticated, userId } = getAuth(request);

      if (!isAuthenticated || !userId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const { id } = request.params;
      const merchantId = userId;

      const amountRaw = request.body?.amount;
      const amount =
        typeof amountRaw === "number" && Number.isFinite(amountRaw)
          ? amountRaw
          : 1;

      const card = await Card.findOne({ _id: id, merchantId });
      if (!card) {
        return reply.code(404).send({ error: "Card not found" });
      }

      // defaultní práh
      let threshold = 10;

      if (card.customerId) {
        const customer = await Customer.findOne({
          customerId: card.customerId,
          merchantId,
        }).lean();

        const t = Number(customer?.settings?.freeStampsToReward);
        if (Number.isFinite(t) && t > 0) threshold = t;
      }

      let newStamps = (card.stamps || 0) + amount;
      let newRewards = card.rewards || 0;

      while (newStamps >= threshold) {
        newRewards += 1;
        newStamps -= threshold;
      }

      card.stamps = newStamps;
      card.rewards = newRewards;

      await card.save();
      return reply.send(card);
    } catch (err) {
      request.log.error(err, "Error adding stamp");
      return reply.code(500).send({ error: "Error adding stamp" });
    }
  });

  /**
   * GET /api/cards/:id/public
   * „Public“ data karty pro mobil / wallet
   * – zjednodušený pohled, + cardContent z Customer.
   * ⚠️ ZÁMĚRNĚ BEZ AUTH – použije se např. z mobilu / Walletu.
   */
  fastify.get("/api/cards/:id/public", async (request, reply) => {
    try {
      const { id } = request.params;
      const card = await Card.findById(id);
      if (!card) {
        return reply.code(404).send({ error: "Card not found" });
      }

      let customer = null;
      if (card.customerId) {
        // public endpoint → nefiltrujeme merchantId, protože klient ho nezná
        customer = await Customer.findOne({ customerId: card.customerId }).lean();
      }

      const normalizedCardContent = normalizeCardContent(customer?.cardContent || {});

      const payload = {
        cardId: card._id,
        customerId: card.customerId,
        customerName: customer?.name || null,
        stamps: card.stamps,
        rewards: card.rewards,

        // obsah karty
        headline: normalizedCardContent.headline,
        subheadline: normalizedCardContent.subheadline,
        openingHours: normalizedCardContent.openingHours,
        customMessage: normalizedCardContent.customMessage,
        websiteUrl: normalizedCardContent.websiteUrl,

        // vizuál (kompatibilita + nové fields)
        themeColor: normalizedCardContent.primaryColor,
        themeVariant: normalizedCardContent.themeVariant,
        primaryColor: normalizedCardContent.primaryColor,
        secondaryColor: normalizedCardContent.secondaryColor,

        // ostatní
        logoUrl: customer?.settings?.logoUrl || null,
        lastUpdatedAt: customer?.cardContent?.lastUpdatedAt || null,
      };

      return reply.send(payload);
    } catch (err) {
      request.log.error(err, "Error fetching public card data");
      return reply.code(500).send({ error: "Error fetching public card data" });
    }
  });
}

export default cardRoutes;
