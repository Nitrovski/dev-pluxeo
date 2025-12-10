// src/server.js
import Fastify from 'fastify';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from '@fastify/cors';

// Clerk fastify plugin
import { clerkPlugin } from '@clerk/fastify';

import cardRoutes from './routes/card.routes.js';
import customerRoutes from './routes/customer.routes.js';

dotenv.config();

const fastify = Fastify({
  logger: true,
});

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

    // CORS – pro vývoj povolíme všechny originy
    await fastify.register(cors, {
      origin: true, // vrátí Access-Control-Allow-Origin dle originu requestu
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'X-Api-Key',
        'Authorization', // kvuli Bearer tokenum z Clerku
      ],
    });

    // ?? Clerk plugin – MUSÍ být zaregistrovaný pred /api routami
    await fastify.register(clerkPlugin, {
      secretKey: clerkSecretKey,
      publishableKey: clerkPublishableKey,
      // hookName: 'preHandler', // defaultne, mužeš prepsat když bys chtel
    });

    // Health-check / test endpoint
    fastify.get('/', async () => {
      return { status: 'Pluxeo API beží' };
    });

    // Sem ted už authRoutes / authPlugin nedáváme – Clerk reší auth

    // Ostatní routes (už budou mít k dispozici getAuth(request) z @clerk/fastify)
    fastify.register(cardRoutes);
    fastify.register(customerRoutes);

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
