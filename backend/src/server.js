// src/server.js
import 'dotenv/config';
import Fastify from 'fastify';
import mongoose from 'mongoose';
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
import { publicGoogleWalletRoutes } from "./routes/public.wallet.google.routes.js";

import { Card } from "./models/card.model.js";

console.log("Mongoose models loaded:", Object.keys(mongoose.models));

const rcPath = Card.schema.path("redeemCodes");
console.log("RedeemCodes path instance:", rcPath?.instance);

const rcSchema = rcPath?.schema;
console.log("RedeemCode schema paths:", rcSchema ? Object.keys(rcSchema.paths) : null);

// Clerk fastify plugin
import { clerkPlugin } from '@clerk/fastify';

// Routes
import cardRoutes from './routes/card.routes.js';
import customerRoutes from './routes/customer.routes.js';
import cardTemplateRoutes from "./routes/cardTemplate.routes.js";
import { cardTemplateStarterRoutes } from "./routes/cardTemplate.starters.routes.js";
import { googleWalletConfig } from "./config/googleWallet.config.js";
import { merchantWalletGoogleRoutes } from "./routes/merchant.wallet.google.routes.js";

const fastify = Fastify({
  logger: true,
});

// Clerk decode middleware
clerkAuthMiddleware(fastify);

// MongoDB URL z env
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  fastify.log.error('Chybi MONGODB_URI v env promennych');
  process.exit(1);
}

// Clerk env promenne
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY;

if (!clerkSecretKey || !clerkPublishableKey) {
  fastify.log.error('Chybi CLERK_SECRET_KEY nebo CLERK_PUBLISHABLE_KEY v env promennych');
  process.exit(1);
}

fastify.log.info({
  issuerId: googleWalletConfig.issuerId,
  classPrefix: googleWalletConfig.classPrefix,
}, 'Google Wallet config loaded');

const start = async () => {
  try {
    // Pripojeni k MongoDB
    await mongoose.connect(mongoUri);
    fastify.log.info('MongoDB pripojena');

    // CORS - povolime vsechny originy (MVP)
    await fastify.register(cors, {
      origin: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });

    await fastify.register(rateLimit, {
      global: false, // jen na vybrane routy
    });
    // Clerk plugin musi byt registrovan PRED routami
    await fastify.register(clerkPlugin, {
      secretKey: clerkSecretKey,
      publishableKey: clerkPublishableKey,
    });

    // Health-check
    fastify.get('/', async () => {
      return { status: 'Pluxeo API bezi' };
    });

    // API routes (autorizace resime pres getAuth(request))
    fastify.register(cardRoutes);
    fastify.register(customerRoutes);
    fastify.register(cardTemplateRoutes); // pridani template rout
    fastify.register(cardTemplateStarterRoutes);
    fastify.register(meRoutes);
    fastify.register(dashboardRoutes);
    fastify.register(merchantEnrollmentRoutes);
    fastify.register(enrollRoutes);
    fastify.register(merchantScanRoutes);
    fastify.register(publicCardRoutes);
    fastify.register(publicGoogleWalletRoutes);
    fastify.register(merchantStampRoutes);
    fastify.register(merchantWalletGoogleRoutes);


    // Start serveru
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });

    fastify.log.info(`Server bezi na portu ${port}`);
  } catch (err) {
    fastify.log.error(err, 'Chyba pri startu serveru');
    process.exit(1);
  }
};

start();
