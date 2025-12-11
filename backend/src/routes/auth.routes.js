// src/routes/auth.routes.js
import bcrypt from "bcrypt";
import { Merchant } from "../models/merchant.model.js";
import { User } from "../models/user.model.js";

const SALT_ROUNDS = 10;

export default async function authRoutes(fastify, options) {
  /**
   * POST /api/auth/merchants/register
   * regustrace noveho obchodnika
   */
  fastify.post("/api/auth/merchants/register", async (request, reply) => {
    try {
      const { name, email, password } = request.body;

      if (!name || !email || !password) {
        return reply
          .code(400)
          .send({ error: "Missing name, email or password" });
      }

      const existing = await Merchant.findOne({ email });
      if (existing) {
        return reply
          .code(409)
          .send({ error: "Merchant with this email already exists" });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      const merchant = await Merchant.create({
        name,
        email,
        passwordHash,
      });

      const token = fastify.jwtSignMerchant(merchant);

      return reply.code(201).send({
        token,
        merchant: {
          id: merchant._id,
          name: merchant.name,
          email: merchant.email,
        },
      });
    } catch (err) {
      request.log.error(err, "Error registering merchant");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });
  
  // POST /api/auth/sync
  fastify.post("/api/auth/sync", async (request, reply) => {
    try {
      const clerkUserId = request.userId; // pridáme middleware níe

      if (!clerkUserId) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      let user = await User.findOne({ clerkUserId });

      if (!user) {
        // zatím 1 merchant/testovací
        user = await User.create({
          clerkUserId,
          customerId: "pluxeo-coffee", // TODO: pozdeji dynamické
        });
      }

      return reply.send({
        clerkUserId: user.clerkUserId,
        customerId: user.customerId,
      });
    } catch (err) {
      request.log.error(err);
      reply.code(500).send({ error: "Failed to sync user" });
    }
  });

  /**
   * POST /api/auth/merchants/login
   */
  fastify.post("/api/auth/merchants/login", async (request, reply) => {
    try {
      const { email, password } = request.body;

      if (!email || !password) {
        return reply.code(400).send({ error: "Missing email or password" });
      }

      const merchant = await Merchant.findOne({ email });
      if (!merchant) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      const passwordMatch = await bcrypt.compare(
        password,
        merchant.passwordHash
      );
      if (!passwordMatch) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      const token = fastify.jwtSignMerchant(merchant);

      return reply.send({
        token,
        merchant: {
          id: merchant._id,
          name: merchant.name,
          email: merchant.email,
        },
      });
    } catch (err) {
      request.log.error(err, "Error logging in merchant");
      return reply.code(500).send({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/auth/merchants/me
   * – test chránené route
   */
  fastify.get(
    "/api/auth/merchants/me",
    {
      preHandler: [fastify.authenticate], // ? tady bylo undefined
    },
    async (request, reply) => {
      return reply.send({ merchant: request.merchant });
    }
  );
}
