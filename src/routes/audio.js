import { Router } from 'express';
import express from 'express';
import mongoose from 'mongoose';
import { Readable } from 'node:stream';
import AudioSettings from '../models/AudioSettings.js';

export const SLOTS = ['welcome', 'admin'];
const MAX_BYTES = Math.round((Number(process.env.AUDIO_MAX_MB) || 5) * 1024 * 1024);
const MIN_BYTES = 1024;

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'audio' });
const getSettings = async () => (await AudioSettings.findOne({ key: 'audio' })) ?? new AudioSettings({ key: 'audio' });

function publicSlot(s) {
  return s?.fileId
    ? { custom: true, filename: s.filename, size: s.size, version: s.version, updatedAt: s.updatedAt }
    : { custom: false };
}
const publicConfig = (doc) => ({ ok: true, maxBytes: MAX_BYTES, welcome: publicSlot(doc.welcome), admin: publicSlot(doc.admin) });

// Audio files live in MongoDB (GridFS). If the database is not connected there is nowhere to store or read them, so say so.
function requireStorage(_req, res, next) {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({ ok: false, message: 'Audio storage (MongoDB) is not available right now. Check MONGODB_URI.' });
  }
  next();
}

function validSlot(req, res, next) {
  if (!SLOTS.includes(req.params.slot)) return res.status(404).json({ ok: false, message: 'Unknown audio slot.' });
  next();
}

/** MP3 = ID3v2 tag, or an MPEG audio frame sync (11 set bits). Content-Type and filename are not trusted. */
function looksLikeMp3(buf) {
  if (buf.length < 4) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true;
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

function cleanFilename(raw, slot) {
  let name = '';
  try { name = decodeURIComponent(String(raw ?? '')); } catch { name = ''; }
  name = name.split(/[\\/]/).pop().replace(/[^A-Za-z0-9._ -]/g, '').trim().slice(0, 100);
  if (!name) name = `${slot}.mp3`;
  return name.toLowerCase().endsWith('.mp3') ? name : `${name}.mp3`;
}

/* ---------- Public: configuration + file streaming (visitors need these to hear the welcome sound) ---------- */
export const publicAudioRouter = Router();
publicAudioRouter.use(requireStorage);

publicAudioRouter.get('/', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-cache');
    res.json(publicConfig(await getSettings()));
  } catch (err) {
    next(err);
  }
});

publicAudioRouter.get('/:slot', validSlot, async (req, res, next) => {
  try {
    const s = (await getSettings())[req.params.slot];
    if (!s?.fileId) return res.status(404).json({ ok: false, message: 'No custom audio set; the bundled default is used.' });
    const size = s.size;
    // The files are loaded cross-origin by <audio> from the frontend, so Helmet's same-origin policy must be relaxed here.
    res.set({
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache',
    });

    let start = 0;
    let end = size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      if (range[1] !== '') { start = Number(range[1]); if (range[2] !== '') end = Math.min(Number(range[2]), size - 1); }
      else if (range[2] !== '') { start = Math.max(0, size - Number(range[2])); }
      if (start > end || start >= size) {
        res.set('Content-Range', `bytes */${size}`);
        return res.status(416).end();
      }
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.set('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') return res.end();
    const stream = bucket().openDownloadStream(s.fileId, { start, end: end + 1 });
    stream.on('error', next);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

/* ---------- Admin only (mounted behind requireAdmin in server.js): upload / restore default ---------- */
export const adminAudioRouter = Router();
adminAudioRouter.use(requireStorage);

adminAudioRouter.get('/', async (_req, res, next) => {
  try {
    res.json(publicConfig(await getSettings()));
  } catch (err) {
    next(err);
  }
});

// Raw MP3 bytes in the request body (no multipart dependency); filename travels in the X-Filename header.
adminAudioRouter.put('/:slot', validSlot, express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res, next) => {
  try {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ ok: false, message: 'No file received.' });
    if (body.length < MIN_BYTES) return res.status(400).json({ ok: false, message: 'That file is too small to be a valid MP3.' });
    if (!looksLikeMp3(body)) return res.status(415).json({ ok: false, message: 'Only MP3 audio files are accepted.' });

    const { slot } = req.params;
    const filename = cleanFilename(req.headers['x-filename'], slot);
    const fileId = await new Promise((resolve, reject) => {
      const up = bucket().openUploadStream(filename, { contentType: 'audio/mpeg', metadata: { slot, uploadedBy: req.admin.email } });
      up.on('error', reject);
      up.on('finish', () => resolve(up.id));
      Readable.from(body).pipe(up);
    });

    const doc = await getSettings();
    const previous = doc[slot]?.fileId;
    doc[slot] = { fileId, filename, size: body.length, version: (doc[slot]?.version ?? 0) + 1, updatedAt: new Date(), updatedBy: req.admin.email };
    await doc.save();
    if (previous) await bucket().delete(previous).catch(() => {}); // old file is no longer referenced
    res.status(201).json(publicConfig(doc));
  } catch (err) {
    next(err);
  }
});

adminAudioRouter.delete('/:slot', validSlot, async (req, res, next) => {
  try {
    const { slot } = req.params;
    const doc = await getSettings();
    const previous = doc[slot]?.fileId;
    doc[slot] = { version: (doc[slot]?.version ?? 0) + 1, updatedAt: new Date(), updatedBy: req.admin.email };
    doc[slot].fileId = undefined;
    await doc.save();
    if (previous) await bucket().delete(previous).catch(() => {});
    res.json(publicConfig(doc));
  } catch (err) {
    next(err);
  }
});
