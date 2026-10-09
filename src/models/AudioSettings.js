import mongoose from 'mongoose';

// One slot per sound. `fileId` points at the uploaded MP3 in GridFS (bucket "audio"); no fileId means "use the bundled default".
const slot = {
  fileId: { type: mongoose.Schema.Types.ObjectId },
  filename: { type: String, trim: true, maxlength: 120 },
  size: { type: Number },
  version: { type: Number, default: 0 }, // bumped on every change; used to cache-bust the file URL
  updatedAt: { type: Date },
  updatedBy: { type: String, trim: true },
};

const audioSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'audio', unique: true },
    welcome: slot,
    admin: slot,
  },
  { timestamps: true }
);

export default mongoose.model('AudioSettings', audioSettingsSchema);
