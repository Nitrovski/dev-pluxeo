import { Customer } from "../models/customer.model.js";
import { normalizeCardContent } from "../utils/normalizeCardContent.js";

export async function customerCardContentRoutes(fastify) {

  // GET card-content
  fastify.get("/api/customers/:customerId/card-content", async (request, reply) => {
    const { customerId } = request.params;

    const customer = await Customer.findOne({ customerId }).lean();
    if (!customer) {
      return reply.code(404).send({ message: "Customer not found" });
    }

    // pokud zatím není cardContent, FE chce 404 -> vrátíme 404
    if (!customer.cardContent) {
      return reply.code(404).send({ message: "Card content not found" });
    }

    // Normalizujeme a rovnou opravíme DB (volitelné, ale doporucuji)
    const normalized = normalizeCardContent(customer.cardContent);

    // pokud se liší, uložíme opravu do DB
    // (lean() vrací plain object -> udeláme update)
    await Customer.updateOne({ customerId }, { $set: { cardContent: normalized } });

    return reply.send(normalized);
  });

  // PATCH card-content
  fastify.patch("/api/customers/:customerId/card-content", async (request, reply) => {
    const { customerId } = request.params;

    // Normalizace inputu (ochrana proti null/NaN)
    const normalized = normalizeCardContent(request.body);

    const updated = await Customer.findOneAndUpdate(
      { customerId },
      { $set: { cardContent: normalized } },
      { new: true, upsert: false } // pokud customer neexistuje, vrátíme 404 níž
    ).lean();

    if (!updated) {
      return reply.code(404).send({ message: "Customer not found" });
    }

    return reply.send(normalized);
  });
}
