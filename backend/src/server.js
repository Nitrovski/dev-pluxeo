import Fastify from 'fastify';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import cors from '@fastify/cors';

import cardRoutes from './routes/card.routes.js';
import customerRoutes from './routes/customer.routes.js';

dotenv.config();

const fastify = Fastify({
  logger: true,
});

//MongoDB URL z env
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

    // CORS – povolíme FE na Vercelu + lokální dev
    await fastify.register(cors, {
      origin: [
        'http://localhost:5173',              // Vite dev
        'https://merchant.pluxeo.vercel.app', // tady pak dej reálnou URL frontendu
      ],
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    });

    // Routes
    fastify.get('/', async () => {
      return { status: 'Pluxeo API bezi' };
    });

    fastify.register(cardRoutes);
    fastify.register(customerRoutes);

    // Start serveru
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`?? Server bezi na portu ${port}`);
  } catch (err) {
    fastify.log.error(err, 'Chyba pri startu serveru');
    process.exit(1);
  }
};

start();

