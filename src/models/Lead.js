import mongoose from 'mongoose';

const replySchema = new mongoose.Schema(
  {
    subject: { type: String, trim: true, maxlength: 200, default: '' },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    sentBy: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['sent', 'failed'], required: true },
    error: { type: String, default: '' },
  },
  { timestamps: { createdAt: 'sentAt', updatedAt: false } }
);

const leadSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 150 },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    subject: { type: String, trim: true, maxlength: 150, default: '' },
    projectType: { type: String, required: true, trim: true, maxlength: 80 },
    budget: { type: String, trim: true, maxlength: 80, default: '' },
    message: { type: String, required: true, trim: true, maxlength: 3000 },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
    repliedAt: { type: Date },
    replyStatus: { type: String, enum: ['none', 'sent', 'failed'], default: 'none' },
    replies: { type: [replySchema], default: [] },
  },
  { timestamps: true }
);

leadSchema.index({ createdAt: -1 });

export default mongoose.model('Lead', leadSchema);
