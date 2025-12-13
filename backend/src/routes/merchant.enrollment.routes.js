import { Customer } from "../models/customer.model.js";
import { ensureEnrollment } from "../lib/enrollment.js";

export async function merchantEnrollmentRoutes(fastify) {
  fastify.get("/api/merchant/enrollment", async (request, reply) => {
    try {
      // ✅ Auth přes middleware (request.userId)
      const merchantId = request.userId;
      if (!merchantId) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

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
    } catch (err) {
      request.log.error(err, "merchant enrollment route failed");
      return reply.code(500).send({ error: "Enrollment endpoint failed" });
    }
  });
}
