// src/routes/customer.routes.js
import { Customer } from "../models/customer.model.js";

async function customerRoutes(fastify, options) {
  // 1) Vytvorení nového zákazníka (provozovny)
  fastify.post("/api/customers", async (request, reply) => {
    try {
      const customer = await Customer.create(request.body);
      return reply.code(201).send(customer);
    } catch (err) {
      request.log.error(err, "Error creating customer");

      // Mongo duplicate key (napr. unique customerId)
      if (err.code === 11000) {
        return reply
          .code(409)
          .send({ error: "Customer with this customerId already exists" });
      }

      return reply.code(500).send({ error: "Error creating customer" });
    }
  });

  // 2) Získání zákazníka podle customerId (to bude v QR kódu / adminu)
  fastify.get("/api/customers/:customerId", async (request, reply) => {
    try {
      const { customerId } = request.params;
      const customer = await Customer.findOne({ customerId }).lean();

      if (!customer) {
        return reply.code(404).send({ error: "Customer not found" });
      }

      return reply.send(customer);
    } catch (err) {
      request.log.error(err, "Error fetching customer");
      return reply.code(500).send({ error: "Error fetching customer" });
    }
  });

  // 3) GET – vrátí pouze obsah/šablonu karty (pro tvoji šablonovací stránku)
  fastify.get(
    "/api/customers/:customerId/card-content",
    async (request, reply) => {
      try {
        const { customerId } = request.params;
        const customer = await Customer.findOne({ customerId }).lean();

        if (!customer) {
          return reply.code(404).send({ error: "Customer not found" });
        }

        // pokud ješte nic není nastavené, vrátíme prázdný objekt
        return reply.send(customer.cardContent || {});
      } catch (err) {
        request.log.error(err, "Error fetching card content");
        return reply
          .code(500)
          .send({ error: "Error fetching card content" });
      }
    }
  );

  // 4) PATCH – uloží / updatuje obsah karty (naše šablona)
  fastify.patch(
    "/api/customers/:customerId/card-content",
    async (request, reply) => {
      try {
        const { customerId } = request.params;
        const payload = request.body || {};

        const customer = await Customer.findOne({ customerId });
        if (!customer) {
          return reply.code(404).send({ error: "Customer not found" });
        }

        // Bezpecné sloucení stávajícího cardContent + payload
        const existingContent =
          customer.cardContent && typeof customer.cardContent === "object"
            ? customer.cardContent
            : {};

        customer.cardContent = {
          ...existingContent,
          ...payload,
          lastUpdatedAt: new Date(),
        };

        await customer.save();

        return reply.send(customer.cardContent);
      } catch (err) {
        request.log.error(err, "Error updating card content");
        return reply
          .code(500)
          .send({ error: "Error updating card content" });
      }
    }
  );
}

export default customerRoutes;
