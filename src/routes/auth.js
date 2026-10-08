import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { EMAIL_RE, hashPassword, passwordError, verifyPassword } from '../utils/password.js';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Too many attempts. Please try again later.' },
});

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role });
const duplicate = { ok: false, errors: { email: 'An account with this email already exists.' } };

// Public registration always creates role "user"; admins are only created with `npm run create-admin`.
router.post('/register', limiter, async (req, res, next) => {
  try {
    const { name, email, password } = req.body ?? {};
    const errors = {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) errors.name = 'Please enter your name.';
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) errors.email = 'Please enter a valid email.';
    const pwErr = passwordError(password);
    if (pwErr) errors.password = pwErr;
    if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });

    const normalized = email.trim().toLowerCase();
    if (await User.exists({ email: normalized })) return res.status(409).json(duplicate);
    let user;
    try {
      user = await User.create({ name: name.trim(), email: normalized, passwordHash: await hashPassword(password), role: 'user' });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json(duplicate);
      throw err;
    }
    res.status(201).json({ ok: true, token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || typeof password !== 'string' || !password) {
      return res.status(400).json({ ok: false, message: 'Enter a valid email and password.' });
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordHash');
    const valid = await verifyPassword(password, user?.passwordHash);
    if (!user || !valid) return res.status(401).json({ ok: false, message: 'Invalid email or password.' });
    res.json({ ok: true, token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => res.json({ ok: true, user: publicUser(req.user) }));

export default router;
