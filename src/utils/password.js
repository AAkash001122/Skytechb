import bcrypt from 'bcryptjs';

const ROUNDS = 12;
// Compared against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', ROUNDS);

export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash ?? DUMMY_HASH);

/** Returns an error message, or '' when the password is acceptable. */
export function passwordError(pw, min = 8) {
  if (typeof pw !== 'string' || pw.length < min) return `Password must be at least ${min} characters.`;
  if (pw.length > 72) return 'Password must be 72 characters or fewer.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain at least one letter and one number.';
  return '';
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
