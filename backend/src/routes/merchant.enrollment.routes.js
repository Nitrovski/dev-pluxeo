import { Customer } from "../models/customer.model.js";
import { ensureEnrollment } from "../lib/enrollment.js";

export async function merchantEnrollmentRoutes(fastify) {
  fastify.get("/api/merchant/enrollment", async (request, reply) => {
    const { isAuthenticated, userId } = getAuth(request);
    if (!isAuthenticated || !userId) {
      return reply.code(401).send({ error: "Missing or invalid token" });
    }

    const merchantId = userId;

    const customer = await Customer.findOne({ merchantId });
    if (!customer) {
      return reply
        .code(404)
        .send({ error: "Customer profile not found. Run onboarding first." });
    }

    const enrollment = await ensureEnrollment(customer);

    const baseUrl = process.env.PUBLIC_APP_BASE_URL || "http://localhost:5173";
    const enrollUrl = `${baseUrl}/e/${enrollment.code}`;

    return reply.send({
      merchantId,
      customerId: customer.customerId,
      businessName: customer.name,
      enrollment: {
        ...enrollment,
        url: enrollUrl,
      },
    });
  });
}
