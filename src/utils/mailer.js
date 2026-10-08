import nodemailer from 'nodemailer';

let transporter;

export function mailConfigured() {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getTransporter() {
  if (!transporter) {
    const { SMTP_HOST, SMTP_PORT = '587', SMTP_SECURE, SMTP_USER, SMTP_PASS } = process.env;
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: SMTP_SECURE ? SMTP_SECURE === 'true' : Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

const escapeHtml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function sendReplyEmail({ to, name, subject, body, originalMessage }) {
  if (!mailConfigured()) throw new Error('Email is not configured on the server (SMTP_* variables).');
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const safeSubject = subject.replace(/[\r\n]+/g, ' ').slice(0, 200);
  const text = `${body}\n\n---\nYour original message:\n${originalMessage}`;
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">` +
    `<p style="white-space:pre-wrap">${escapeHtml(body)}</p>` +
    `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0"/>` +
    `<p style="color:#666;font-size:13px">Your original message, ${escapeHtml(name)}:</p>` +
    `<blockquote style="margin:0;padding-left:12px;border-left:3px solid #ddd;color:#555;white-space:pre-wrap">${escapeHtml(originalMessage)}</blockquote></div>`;
  await getTransporter().sendMail({ from, to, subject: safeSubject, text, html });
}

export async function sendResetEmail({ to, link }) {
  if (!mailConfigured()) throw new Error('Email is not configured on the server (SMTP_* variables).');
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const text = `We received a request to reset your SkyTech admin password.\n\nOpen this link within 30 minutes:\n${link}\n\nIf you did not ask for this, ignore this email.`;
  const html =
    `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#111">` +
    `<p>We received a request to reset your SkyTech admin password.</p>` +
    `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#20C7E8;color:#080D19;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Reset password</a></p>` +
    `<p style="color:#666;font-size:13px">This link expires in 30 minutes. If you did not ask for this, ignore this email.</p></div>`;
  await getTransporter().sendMail({ from, to, subject: 'Reset your SkyTech admin password', text, html });
}
