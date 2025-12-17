// src/server.js
import Fastify from 'fastify';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from '@fastify/cors';
import { clerkAuthMiddleware } from "./middleware/auth.js"; //import middleware
import meRoutes from "./routes/me.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import { merchantEnrollmentRoutes } from "./routes/merchant.enrollment.routes.js";
import enrollRoutes from "./routes/enroll.routes.js";
import rateLimit from "@fastify/rate-limit";
import { merchantScanRoutes } from "./routes/merchant.scan.routes.js";
import { publicCardRoutes } from "./routes/public.card.routes.js";
import { merchantStampRoutes } from "./routes/merchant.stamp.routes.js";



// Clerk fastify plugin
import { clerkPlugin } from '@clerk/fastify';

// Routes
import cardRoutes from './routes/card.routes.js';
import customerRoutes from './routes/customer.routes.js';
import cardTemplateRoutes from "./routes/cardTemplate.routes.js";

dotenv.config();

const fastify = Fastify({
  logger: true,
});

// Clerk decode middleware
clerkAuthMiddleware(fastify);

// MongoDB URL z env
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  fastify.log.error('? Chybí MONGODB_URI v env promenných');
  process.exit(1);
}

// Clerk env promenné
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY;

if (!clerkSecretKey || !clerkPublishableKey) {
  fastify.log.error('? Chybí CLERK_SECRET_KEY nebo CLERK_PUBLISHABLE_KEY v env promenných');
  process.exit(1);
}

const start = async () => {
  try {
    // Pripojení k MongoDB
    await mongoose.connect(mongoUri);
    fastify.log.info('? MongoDB pripojena');

    // CORS – povolíme všechny originy (MVP)
    await fastify.register(cors, {
      origin: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });

    await fastify.register(rateLimit, {
      global: false, // jen na vybrané routy
    });
    // Clerk plugin musí být registrován PRED routami
    await fastify.register(clerkPlugin, {
      secretKey: clerkSecretKey,
      publishableKey: clerkPublishableKey,
    });

    // Health-check
    fastify.get('/', async () => {
      return { status: 'Pluxeo API beží' };
    });

    // API routes (autorizace rešíme pres getAuth(request))
    fastify.register(cardRoutes);
    fastify.register(customerRoutes);
    fastify.register(cardTemplateRoutes); // pridáni template rout
    fastify.register(meRoutes);
    fastify.register(dashboardRoutes);
    fastify.register(merchantEnrollmentRoutes);
    fastify.register(enrollRoutes);
    fastify.register(merchantScanRoutes);
    fastify.register(publicCardRoutes);
    fastify.register(merchantStampRoutes);
 

    // Start serveru
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });

    fastify.log.info(`?? Server beží na portu ${port}`);
  } catch (err) {
    fastify.log.error(err, '? Chyba pri startu serveru');
    process.exit(1);
  }
};

start();
