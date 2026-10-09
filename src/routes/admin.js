import { Router } from 'express';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import User from '../models/User.js';
import Lead from '../models/Lead.js';
import { requireAdmin, signToken } from '../middleware/auth.js';
import { sendReplyEmail, sendResetEmail } from '../utils/mailer.js';
import { EMAIL_RE, hashPassword, passwordError, verifyPassword } from '../utils/password.js';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || typeof password !== 'string' || !password) {
      return res.status(400).json({ ok: false, message: 'Enter a valid email and password.' });
    }
    const admin = await User.findOne({ email: email.trim().toLowerCase(), role: 'admin' }).select('+passwordHash');
    const valid = await verifyPassword(password, admin?.passwordHash);
    if (!admin || !valid) return res.status(401).json({ ok: false, message: 'Invalid email or password.' });
    res.json({ ok: true, token: signToken(admin), admin: { email: admin.email }, mailFrom: mailFrom() });
  } catch (err) {
    next(err);
  }
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Too many requests. Please try again later.' },
});

const RESET_TTL_MS = 30 * 60 * 1000;
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Always answers the same way so it cannot be used to discover which emails are admins.
router.post('/forgot-password', resetLimiter, async (req, res, next) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, message: 'Enter a valid email.' });
    const generic = { ok: true, message: 'If that email belongs to an admin, a reset link has been sent.' };
    const admin = await User.findOne({ email, role: 'admin' });
    if (!admin) return res.json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    admin.resetTokenHash = sha256(token);
    admin.resetTokenExpires = new Date(Date.now() + RESET_TTL_MS);
    await admin.save();

    const base = (process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:5173').trim().replace(/\/$/, '');
    const link = `${base}/admin/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
    try {
      await sendResetEmail({ to: email, link });
    } catch (err) {
      console.error('Reset email failed:', err.message);
      if (process.env.NODE_ENV !== 'production') console.log(`[dev] Password reset link for ${email}: ${link}`);
    }
    res.json(generic);
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', resetLimiter, async (req, res, next) => {
  try {
    const { email, token, password } = req.body ?? {};
    const pwErr = passwordError(password, 10);
    if (pwErr) return res.status(400).json({ ok: false, message: pwErr });
    const invalid = { ok: false, message: 'This reset link is invalid or has expired.' };
    if (typeof email !== 'string' || typeof token !== 'string' || !token) return res.status(400).json(invalid);

    const admin = await User.findOne({ email: email.trim().toLowerCase(), role: 'admin' }).select('+resetTokenHash +resetTokenExpires');
    const stored = admin?.resetTokenHash;
    const given = sha256(token);
    const valid =
      stored && admin.resetTokenExpires > new Date() &&
      stored.length === given.length && crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(given));
    if (!valid) return res.status(400).json(invalid);

    admin.passwordHash = await hashPassword(password);
    admin.resetTokenHash = undefined;
    admin.resetTokenExpires = undefined;
    await admin.save();
    res.json({ ok: true, message: 'Password updated. You can now sign in.' });
  } catch (err) {
    next(err);
  }
});

// Everything below requires a valid admin token (role "admin").
router.use(requireAdmin);

router.post('/change-password', async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ ok: false, message: 'Enter your current password.' });
    }
    const pwErr = passwordError(newPassword, 10);
    if (pwErr) return res.status(400).json({ ok: false, message: pwErr });
    if (newPassword === currentPassword) return res.status(400).json({ ok: false, message: 'New password must be different.' });
    const admin = await User.findById(req.admin.id).select('+passwordHash');
    if (!(await verifyPassword(currentPassword, admin.passwordHash))) {
      return res.status(400).json({ ok: false, message: 'Current password is incorrect.' });
    }
    admin.passwordHash = await hashPassword(newPassword);
    await admin.save();
    res.json({ ok: true, message: 'Password changed.' });
  } catch (err) {
    next(err);
  }
});

// Only the sender address is shown to the admin; SMTP credentials never leave the server.
const mailFrom = () => {
  const raw = process.env.MAIL_FROM || process.env.SMTP_USER || '';
  return raw.match(/<([^>]+)>/)?.[1] ?? raw;
};

router.get('/me', (req, res) => res.json({ ok: true, admin: { email: req.admin.email }, mailFrom: mailFrom() }));

const unreadFilter = { isRead: { $ne: true } };

router.get('/notifications', async (_req, res, next) => {
  try {
    const [unread, latest] = await Promise.all([
      Lead.countDocuments(unreadFilter),
      Lead.find(unreadFilter).sort({ createdAt: -1 }).limit(5).select('name email subject projectType message createdAt').lean(),
    ]);
    res.json({
      ok: true,
      unread,
      items: latest.map((m) => ({
        _id: m._id,
        name: m.name,
        email: m.email,
        subject: m.subject || `${m.projectType} enquiry`,
        preview: m.message.length > 120 ? `${m.message.slice(0, 120)}...` : m.message,
        createdAt: m.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/stats', async (_req, res, next) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const DAYS = 14;
    const first = new Date();
    first.setUTCHours(0, 0, 0, 0);
    first.setUTCDate(first.getUTCDate() - (DAYS - 1));
    const [total, unread, replied, today, perDay] = await Promise.all([
      Lead.countDocuments(),
      Lead.countDocuments(unreadFilter),
      Lead.countDocuments({ replyStatus: 'sent' }),
      Lead.countDocuments({ createdAt: { $gte: startOfDay } }),
      Lead.aggregate([
        { $match: { createdAt: { $gte: first } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
    ]);
    const counts = new Map(perDay.map((d) => [d._id, d.count]));
    const daily = Array.from({ length: DAYS }, (_, i) => {
      const d = new Date(first);
      d.setUTCDate(first.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      return { date, count: counts.get(date) ?? 0 };
    });
    res.json({ ok: true, total, unread, replied, today, daily });
  } catch (err) {
    next(err);
  }
});

function validId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ ok: false, message: 'Invalid message id.' });
  next();
}

router.get('/messages', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const filter = {};
    if (req.query.status === 'unread') filter.isRead = { $ne: true };
    else if (req.query.status === 'read') filter.isRead = true;
    if (typeof req.query.q === 'string' && req.query.q.trim()) {
      const rx = new RegExp(req.query.q.trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { subject: rx }, { message: rx }];
    }
    const [items, total, unread] = await Promise.all([
      Lead.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('-replies.body')
        .lean(),
      Lead.countDocuments(filter),
      Lead.countDocuments({ isRead: { $ne: true } }),
    ]);
    res.json({
      ok: true,
      items: items.map(({ replies = [], ...m }) => ({ ...m, isRead: Boolean(m.isRead), replyStatus: m.replyStatus || 'none', replyCount: replies.length })),
      total,
      unread,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/messages/:id', validId, async (req, res, next) => {
  try {
    const message = await Lead.findById(req.params.id);
    if (!message) return res.status(404).json({ ok: false, message: 'Message not found.' });
    res.json({ ok: true, message });
  } catch (err) {
    next(err);
  }
});

router.patch('/messages/:id/read', validId, async (req, res, next) => {
  try {
    const { isRead } = req.body ?? {};
    if (typeof isRead !== 'boolean') return res.status(400).json({ ok: false, message: 'isRead must be true or false.' });
    const update = isRead ? { isRead: true, readAt: new Date() } : { isRead: false, $unset: { readAt: 1 } };
    const message = await Lead.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!message) return res.status(404).json({ ok: false, message: 'Message not found.' });
    res.json({ ok: true, message });
  } catch (err) {
    next(err);
  }
});

router.delete('/messages/:id', validId, async (req, res, next) => {
  try {
    const message = await Lead.findByIdAndDelete(req.params.id);
    if (!message) return res.status(404).json({ ok: false, message: 'Message not found.' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/messages/:id/reply', validId, async (req, res, next) => {
  try {
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (body.length < 2 || body.length > 5000) {
      return res.status(400).json({ ok: false, errors: { body: 'Reply must be between 2 and 5000 characters.' } });
    }
    const rawSubject = typeof req.body?.subject === 'string' ? req.body.subject.replace(/\s+/g, ' ').trim() : '';
    if (rawSubject.length > 200) return res.status(400).json({ ok: false, errors: { subject: 'Subject must be 200 characters or fewer.' } });
    const message = await Lead.findById(req.params.id);
    if (!message) return res.status(404).json({ ok: false, message: 'Message not found.' });
    const subject = rawSubject || `Re: ${message.subject || 'Contact Form Inquiry'}`;

    let error = '';
    try {
      await sendReplyEmail({
        to: message.email,
        name: message.name,
        subject,
        body,
        originalMessage: message.message,
      });
    } catch (err) {
      console.error('Reply email failed:', err.message);
      error = err.message;
    }

    message.replies.push({ subject, body, sentBy: req.admin.email, status: error ? 'failed' : 'sent', error });
    message.replyStatus = error ? 'failed' : 'sent';
    if (!error) {
      message.repliedAt = new Date();
      message.isRead = true;
      message.readAt ??= new Date();
    }
    await message.save();

    if (error) {
      return res.status(502).json({ ok: false, message: `Reply saved but email was not delivered: ${error}`, lead: message });
    }
    res.status(201).json({ ok: true, message });
  } catch (err) {
    next(err);
  }
});

export default router;
