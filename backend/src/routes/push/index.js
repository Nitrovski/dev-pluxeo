// backend/src/routes/push/index.js
import { pushRoutes } from "./push.routes.js";

export default async function pushRoutesPlugin(fastify) {
  fastify.register(pushRoutes, { prefix: "/api/push" });
}
