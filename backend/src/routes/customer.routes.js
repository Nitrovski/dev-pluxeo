import { Customer } from "../models/customer.model.js";

async function customerRoutes(fastify, options) {
  // Vytvorení nového zákazníka (provozovny)
  fastify.post("/api/customers", async (request, reply) => {
    try {
      const customer = await Customer.create(request.body);
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

  // Získání zákazníka podle customerId (to bude v QR kódu)
  fastify.get("/api/customers/:customerId", async (request, reply) => {
    try {
      const { customerId } = request.params;
      const customer = await Customer.findOne({ customerId });
      if (!customer) {
        return reply.code(404).send({ error: "Customer not found" });
      }
      return reply.send(customer);
    } catch (err) {
      request.log.error(err, "Error fetching customer");
      return reply.code(500).send({ error: "Error fetching customer" });
    }
  });
}

 // update obsahu karty
  fastify.patch("/api/customers/:customerId/card-content", async (request, reply) => {
    try {
      const { customerId } = request.params;
      const payload = request.body || {};

      const customer = await Customer.findOne({ customerId });
      if (!customer) {
        return reply.code(404).send({ error: "Customer not found" });
      }

      // jen prepíšeme to, co prišlo (MVP – bez extra validace)
      customer.cardContent = {
        ...customer.cardContent?.toObject?.(),
        ...payload,
        lastUpdatedAt: new Date(),
      };

      await customer.save();

      return reply.send(customer.cardContent);
    } catch (err) {
      request.log.error(err, "Error updating card content");
      return reply.code(500).send({ error: "Error updating card content" });
    }
  });
}

export default customerRoutes;
