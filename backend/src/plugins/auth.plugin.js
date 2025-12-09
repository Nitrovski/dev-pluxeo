// src/plugins/auth.plugin.js
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_EXPIRES_IN = "7d";

async function authPlugin(fastify, options) {
  // Podpis JWT pro merchanta
  fastify.decorate("jwtSignMerchant", (merchant) => {
    return jwt.sign(
      {
        sub: merchant._id.toString(),
        email: merchant.email,
        name: merchant.name,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
  });

  // Middleware pro overení tokenu
  fastify.decorate("authenticate", async function (request, reply) {
    try {
      const authHeader = request.headers["authorization"];

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({ error: "Missing or invalid token" });
      }

      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET);

      request.merchant = {
        id: decoded.sub,
        email: decoded.email,
        name: decoded.name,
      };
    } catch (err) {
      request.log.error(err, "Auth error");
      return reply.code(401).send({ error: "Invalid or expired token" });
    }
  });
}

// ?? Tohle je klícové – dekorace se „propíše“ na root fastify instanci
export default fp(authPlugin);
