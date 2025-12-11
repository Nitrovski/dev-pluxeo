import { getAuth } from "@clerk/fastify";
import { Customer } from "../models/customer.model.js";

export default async function meRoutes(fastify) {
  fastify.get("/api/me", async (request, reply) => {
    const { isAuthenticated, userId } = getAuth(request);
    if (!isAuthenticated || !userId) {
      return reply.code(401).send({ error: "Missing or invalid token" });
    }

    const customer = await Customer.findOne({ merchantId: userId }).lean();
    if (!customer) {
      return reply.code(404).send({ error: "Customer not found for this merchant" });
    }

    return reply.send({
      merchantId: userId,
      customerId: customer.customerId,
      customerName: customer.name ?? null,
    });
  });
}
