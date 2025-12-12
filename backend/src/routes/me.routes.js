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

    // ? vrat jen to, co chceš zobrazovat / používat ve FE
    return reply.send({
      name: customer.name ?? null,
      ico: customer.ico ?? null,
      phone: customer.phone ?? null,
      address: customer.address ?? null,
      websiteUrl: customer.cardContent?.websiteUrl ?? null,
      onboardingCompleted: customer.onboardingCompleted === true,
    });
  });
}
