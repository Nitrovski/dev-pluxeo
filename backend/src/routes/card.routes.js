// src/routes/card.routes.js
import { Card } from "../models/card.model.js";
import { Customer } from "../models/customer.model.js";

async function cardRoutes(fastify, options) {
  /**
   * POST /api/cards
   * Vytvoří novou kartu pro PŘIHLÁŠENÉHO merchanta
   */
  fastify.post(
    "/api/cards",
    {
      preHandler: [fastify.authenticate], // ������ merchant musí být přihlášený
    },
    async (request, reply) => {
      try {
        const merchantId = request.merchant.id;

        // Data z frontendu – customerId, walletToken, notes...
        const payload = request.body || {};

        // merchantId si vždy bereme z JWT (případný merchantId v body přepíšeme)
        const card = await Card.create({
          ...payload,
          merchantId,
        });

        return reply.code(201).send(card);
      } catch (err) {
        request.log.error(err, "Error creating card");

        // Mongo duplicate key (např. unique walletToken)
        if (err.code === 11000) {
          return reply
            .code(409)
            .send({ error: "Card with this walletToken already exists" });
        }

        return reply.code(500).send({ error: "Error creating card" });
      }
    }
  );

  /**
   * GET /api/cards/:id
   * Vrátí detail karty podle ID (plná data) – jen když patří danému merchantovi
   */
  fastify.get(
    "/api/cards/:id",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const merchantId = request.merchant.id;

        const card = await Card.findOne({ _id: id, merchantId });

        if (!card) {
          return reply.code(404).send({ error: "Card not found" });
        }

        return reply.send(card);
      } catch (err) {
        request.log.error(err, "Error fetching card");
        return reply.code(500).send({ error: "Error fetching card" });
      }
    }
  );

  /**
   * POST /api/cards/:id/stamp
   * Přidá razítko (default +1, nebo podle body.amount)
   * a přepočítá rewards podle nastavení Customer (freeStampsToReward).
   * ������ Pouze pro přihlášeného merchanta a jen na jeho kartě.
   */
  fastify.post(
    "/api/cards/:id/stamp",
    {
      preHandler: [fastify.authenticate],
    },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const merchantId = request.merchant.id;

        const amountRaw = request.body?.amount;
        const amount =
          typeof amountRaw === "number" && Number.isFinite(amountRaw)
            ? amountRaw
            : 1;

        // Najdeme kartu, která patří danému merchantovi
        const card = await Card.findOne({ _id: id, merchantId });
        if (!card) {
          return reply.code(404).send({ error: "Card not found" });
        }

        // Defaultní práh, když ještě nemáme Customer
        let threshold = 10;

        // Pokud má karta přiřazený customerId, zkusíme najít zákazníka
        if (card.customerId) {
          const customer = await Customer.findOne({
            customerId: card.customerId,
          });
          if (customer?.settings?.freeStampsToReward) {
            threshold = customer.settings.freeStampsToReward;
          }
        }

        let newStamps = (card.stamps || 0) + amount;
        let newRewards = card.rewards || 0;

        // Přepočet – za každých X razítek jedna odměna
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
    }
  );

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

      // zkusíme najít zákazníka (kvůli obsahu karty a nastavení)
      let customer = null;
      if (card.customerId) {
        customer = await Customer.findOne({ customerId: card.customerId });
      }

      const cardContent = customer?.cardContent || {};
      const settings = customer?.settings || {};

      const payload = {
        cardId: card._id,
        customerId: card.customerId,
        customerName: customer?.name || null,
        stamps: card.stamps,
        rewards: card.rewards,

        // obsah karty
        headline: cardContent.headline || "",
        subheadline: cardContent.subheadline || "",
        openingHours: cardContent.openingHours || "",
        customMessage: cardContent.customMessage || "",
        websiteUrl: cardContent.websiteUrl || "",
        themeColor: settings.themeColor || "#FF9900",
        logoUrl: settings.logoUrl || null,
        lastUpdatedAt: cardContent.lastUpdatedAt || null,
      };

      return reply.send(payload);
    } catch (err) {
      request.log.error(err, "Error fetching public card data");
      return reply
        .code(500)
        .send({ error: "Error fetching public card data" });
    }
  });
}

export default cardRoutes;
