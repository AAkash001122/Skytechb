const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\-\s\d]{7,20}$/;

export function validateContact(req, res, next) {
  const { name, email, phone, subject, projectType, budget, message } = req.body ?? {};
  const errors = {};

  if (typeof name !== 'string' || name.trim().length < 2) errors.name = 'Please enter your name.';
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) errors.email = 'Please enter a valid email.';
  if (phone && (typeof phone !== 'string' || !PHONE_RE.test(phone.trim()))) errors.phone = 'Please enter a valid phone number.';
  if (subject && (typeof subject !== 'string' || subject.trim().length > 150)) errors.subject = 'Subject must be 150 characters or fewer.';
  if (typeof projectType !== 'string' || !projectType.trim()) errors.projectType = 'Please choose a project type.';
  if (typeof message !== 'string' || message.trim().length < 10) errors.message = 'Please tell us a little more (10+ characters).';

  if (Object.keys(errors).length) return res.status(400).json({ ok: false, errors });

  req.contact = {
    name: name.trim(),
    email: email.trim(),
    phone: phone ? phone.trim() : '',
    subject: subject ? subject.trim() : '',
    projectType: projectType.trim(),
    budget: typeof budget === 'string' ? budget.trim() : '',
    message: message.trim(),
  };
  next();
}
