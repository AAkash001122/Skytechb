import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import contactRouter from './routes/contact.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import { adminAudioRouter, publicAudioRouter } from './routes/audio.js';
import { requireAdmin } from './middleware/auth.js';

const { PORT = 5000, MONGODB_URI, JWT_SECRET, CORS_ORIGIN = 'http://localhost:5173' } = process.env;

// Browsers send the origin without a trailing slash, so tolerate a pasted "https://site.vercel.app/" and stray spaces/empty entries.
const allowedOrigins = CORS_ORIGIN.split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);

const app = express();
app.use(helmet());
app.use(cors({ origin: allowedOrigins, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE'] }));
app.use(express.json({ limit: '20kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/contact', contactRouter);
app.use('/api/auth', authRouter);
app.use('/api/settings/audio', publicAudioRouter);
app.use('/api/admin/audio', requireAdmin, adminAudioRouter); // before adminRouter so the raw-body upload parser is used
app.use('/api/admin', adminRouter);

app.use((_req, res) => res.status(404).json({ ok: false, message: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ ok: false, message: 'That file is too large.' });
  console.error(err);
  res.status(500).json({ ok: false, message: 'Something went wrong. Please try again.' });
});

async function start() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI is not set. Copy .env.example to .env.');
  if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be a random string of at least 32 characters.');
  await mongoose.connect(MONGODB_URI);
  console.log(`CORS: allowing ${allowedOrigins.join(', ') || '(none)'}`);
  if (process.env.NODE_ENV === 'production' && !allowedOrigins.some((o) => o.startsWith('https://'))) {
    console.warn('CORS_ORIGIN has no https:// origin. Your deployed frontend will be blocked by the browser. Set CORS_ORIGIN to its URL.');
  }
  app.listen(PORT, () => console.log(`SkyTech API listening on :${PORT}`));
}

start().catch((err) => {
  console.error(`Startup failed: ${err.message}`);
  process.exit(1);
});
