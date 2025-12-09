import Fastify from 'fastify';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

import cardRoutes from './routes/card.routes.js';
import customerRoutes from "./routes/customer.routes.js";


dotenv.config();

const fastify = Fastify({
  logger: true
});

//Pripojení k MongoDB
const mongoUri = process.env.MONGODB_URI;

if (!mongoUri) {
  console.error('? Chybí MONGODB_URI v .env souboru');
  process.exit(1);
}

mongoose
  .connect(mongoUri)
  .then(() => console.log('MongoDB pripojena'))
  .catch((err) => {
    console.error('Chyba MongoDB:', err);
    process.exit(1);
  });

//Základní test endpoint
fastify.get('/', async () => {
  return { status: 'Pluxeo API bezi' };
});

//Registrace routes pro karty
fastify.register(cardRoutes);
fastify.register(customerRoutes);

//Start serveru
const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server beží na portu ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
