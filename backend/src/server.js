// src/server.js
import Fastify from 'fastify';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from '@fastify/cors';

import cardRoutes from './routes/card.routes.js';
import customerRoutes from './routes/customer.routes.js';

// ? nové importy pro autentizaci
import authPlugin from './plugins/auth.plugin.js';
import authRoutes from './routes/auth.routes.js';

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
        'Authorization', // ? kvuli Bearer tokenum
      ],
    });

    // ? registrace auth pluginu (JWT logika) – pred routes
    await fastify.register(authPlugin);

    // Health-check / test endpoint
    fastify.get('/', async () => {
      return { status: 'Pluxeo API bezi' };
    });

    // ? Auth routes (registrace / login merchantu, /me)
    fastify.register(authRoutes);

    // Ostatní routes
    fastify.register(cardRoutes);
    fastify.register(customerRoutes);

    // Start serveru
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`?? Server bezi na portu ${port}`);
  } catch (err) {
    fastify.log.error(err, '? Chyba pri startu serveru');
    process.exit(1);
  }
};

start();
