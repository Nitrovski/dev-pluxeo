import { User } from "../models/user.model.js";

async function meRoutes(fastify, options) {
  fastify.get("/api/me", async (request, reply) => {
    const clerkUserId = request.userId;

    if (!clerkUserId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const user = await User.findOne({ clerkUserId });

    if (!user) {
      return reply.code(404).send({ error: "User not found" });
    }

    return reply.send({
      clerkUserId: user.clerkUserId,
      customerId: user.customerId,
    });
  });
}

export default meRoutes;
