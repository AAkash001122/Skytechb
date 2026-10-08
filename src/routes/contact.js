import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import Lead from '../models/Lead.js';
import { validateContact } from '../middleware/validateContact.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Too many requests. Please try again later.' },
});

router.post('/', limiter, validateContact, async (req, res, next) => {
  try {
    await Lead.create(req.contact);
    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
