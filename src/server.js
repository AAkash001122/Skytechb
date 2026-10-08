import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import contactRouter from './routes/contact.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';

const { PORT = 5000, MONGODB_URI, JWT_SECRET, CORS_ORIGIN = 'http://localhost:5173' } = process.env;

const app = express();
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN.split(',').map((o) => o.trim()), methods: ['GET', 'POST', 'PATCH', 'DELETE'] }));
app.use(express.json({ limit: '20kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/contact', contactRouter);
app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);

app.use((_req, res) => res.status(404).json({ ok: false, message: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, message: 'Something went wrong. Please try again.' });
});

async function start() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI is not set. Copy .env.example to .env.');
  if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be a random string of at least 32 characters.');
  await mongoose.connect(MONGODB_URI);
  app.listen(PORT, () => console.log(`SkyTech API listening on :${PORT}`));
}

start().catch((err) => {
  console.error(`Startup failed: ${err.message}`);
  process.exit(1);
});
