// src/routes/merchant.enrollment.routes.js
import { Customer } from "../models/customer.model.js";
import {
  ensureEnrollment,
  generateEnrollmentCode,
  enforceRotationLimit,
} from "../lib/enrollment.js";

export async function merchantEnrollmentRoutes(fastify) {
  fastify.get("/api/merchant/enrollment", async (request, reply) => {
    try {
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
      const enrollUrl = `${baseUrl.replace(/\/$/, "")}/e/${enrollment.code}`;

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

  fastify.post("/api/merchant/enrollment/rotate", async (request, reply) => {
    try {
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

      // ✅ ensure enrollment exists + defaulty
      const enrollment = await ensureEnrollment(customer);

      // ✅ limit rotací (např. 3/24h)
      const limit = enforceRotationLimit(enrollment, 3);
      if (!limit.allowed) {
        return reply.code(403).send({
          error: "Enrollment rotation limit reached",
          limit: limit.maxPerDay,
          remaining: limit.remaining,
        });
      }

      // ✅ rotate
      const newCode = generateEnrollmentCode();
      const nowIso = new Date().toISOString();

      customer.settings.enrollment.code = newCode;
      customer.settings.enrollment.status = "active";
      customer.settings.enrollment.rotatedAt = nowIso;
      customer.settings.enrollment.rotations = [...limit.recent, nowIso];

      await customer.save();

      const baseUrl = process.env.PUBLIC_APP_BASE_URL || "http://localhost:5173";
      const enrollUrl = `${baseUrl.replace(/\/$/, "")}/e/${newCode}`;

      request.log.info(
        { merchantId, customerId: customer.customerId },
        "Enrollment rotated"
      );

      return reply.send({
        merchantId,
        customerId: customer.customerId,
        businessName: customer.name,
        enrollment: {
          ...customer.settings.enrollment,
          url: enrollUrl,
          rotationLimit: {
            maxPerDay: limit.maxPerDay,
            remaining: limit.maxPerDay - customer.settings.enrollment.rotations.length,
          },
        },
      });
    } catch (err) {
      request.log.error(err, "merchant enrollment rotate failed");
      return reply.code(500).send({ error: "Enrollment rotate failed" });
    }
  });
}
