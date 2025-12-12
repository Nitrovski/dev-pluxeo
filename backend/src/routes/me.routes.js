import { getAuth } from "@clerk/fastify";
import { Customer } from "../models/customer.model.js";

function trimOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function trimOrEmpty(v) {
  if (v === null || v === undefined) return "";
  if (typeof v !== "string") return "";
  return v.trim();
}

export default async function meRoutes(fastify) {
  fastify.get("/api/me", async (request, reply) => {
    const { isAuthenticated, userId } = getAuth(request);
    if (!isAuthenticated || !userId) return reply.code(401).send({ error: "Missing or invalid token" });

    const customer = await Customer.findOne({ merchantId: userId }).lean();
    if (!customer) return reply.code(404).send({ error: "Customer not found for this merchant" });

    return reply.send({
      name: customer.name ?? null,
      ico: customer.ico ?? null,
      phone: customer.phone ?? null,
      address: customer.address ?? null,
      websiteUrl: customer.cardContent?.websiteUrl ?? null,
      onboardingCompleted: customer.onboardingCompleted === true,
    });
  });

  // NOVÉ: update profilu
  fastify.patch("/api/me", async (request, reply) => {
    const { isAuthenticated, userId } = getAuth(request);
    if (!isAuthenticated || !userId) return reply.code(401).send({ error: "Missing or invalid token" });

    const body = request.body || {};

    // name můžeš klidně nechat required i tady (doporučuju)
    const name = trimOrNull(body.name);
    if (!name) return reply.code(400).send({ error: "name is required" });

    const ico = trimOrNull(body.ico);
    const phone = trimOrNull(body.phone);
    const address = typeof body.address === "string" ? trimOrEmpty(body.address) : null;
    const websiteUrl = trimOrNull(body.websiteUrl);

    const customer = await Customer.findOne({ merchantId: userId });
    if (!customer) return reply.code(404).send({ error: "Customer not found for this merchant" });

    customer.name = name;
    customer.ico = ico;
    customer.phone = phone;
    if (address !== null) customer.address = address; // dovol prázdný string
    if (!customer.cardContent) customer.cardContent = {};
    customer.cardContent.websiteUrl = websiteUrl ?? "";

    await customer.save();

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
