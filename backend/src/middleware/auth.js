import jwt from "jsonwebtoken";

export function clerkAuthMiddleware(fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    const header = request.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      return;
    }

    const token = header.replace("Bearer ", "");

    try {
      const decoded = jwt.decode(token);
      if (decoded && decoded.sub) {
        request.userId = decoded.sub;
      }
    } catch (err) {
      console.error("JWT decode failed:", err);
    }
  });
}
