// src/routes/card.routes.js
import { Card } from "../models/card.model.js"; // pokud máš default export, dej: import Card from "../models/card.model.js";

import { Customer } from "../models/customer.model.js";


async function cardRoutes(fastify, options) {
  /**
   * POST /api/cards
   * Vytvoří novou kartu
   */
fastify.post("/api/cards", async (request, reply) => {
  try {
    const card = await Card.create(request.body);
    return reply.code(201).send(card);
  } catch (err) {
    // ������ pomocné logování
    request.log.error(err, "Error creating card");

    // ������ Mongo duplicate key (např. unique walletToken)
    if (err.code === 11000) {
      return reply
        .code(409)
        .send({ error: "Card with this walletToken already exists" });
    }

    return reply.code(500).send({ error: "Error creating card" });
  }
});


  /**
   * GET /api/cards/:id
   * Vrátí detail karty podle ID
   */
  fastify.get("/api/cards/:id", async (request, reply) => {
    try {
      const { id } = request.params;
      const card = await Card.findById(id);
      if (!card) {
        return reply.code(404).send({ error: "Card not found" });
      }
      return reply.send(card);
    } catch (err) {
      request.log.error("Error fetching card:", err);
      return reply.code(500).send({ error: "Error fetching card" });
    }
  });

  /**
   * POST /api/cards/:id/stamp
   * Přidá razítko (default +1, nebo podle body.amount)
   */
fastify.post("/api/cards/:id/stamp", async (request, reply) => {
  try {
    const { id } = request.params;
    const amountRaw = request.body?.amount;
    const amount =
      typeof amountRaw === "number" && Number.isFinite(amountRaw)
        ? amountRaw
        : 1;

    const card = await Card.findById(id);
    if (!card) {
      return reply.code(404).send({ error: "Card not found" });
    }

    // Defaultní práh, když ještě nemáme Customer
    let threshold = 10;

    // Pokud má karta přiřazený customerId, zkusíme najít zákazníka
    if (card.customerId) {
      const customer = await Customer.findOne({ customerId: card.customerId });
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
});

}

export default cardRoutes;
