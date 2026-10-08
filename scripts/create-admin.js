import "dotenv/config";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import {
  EMAIL_RE,
  hashPassword,
  passwordError,
} from "../src/utils/password.js";

const {
  MONGODB_URI,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_NAME = "Admin",
} = process.env;

async function createAdmin() {
  try {
    if (!MONGODB_URI) {
      throw new Error("MONGODB_URI is not set.");
    }

    if (!ADMIN_EMAIL || !EMAIL_RE.test(ADMIN_EMAIL.trim())) {
      throw new Error("ADMIN_EMAIL must be a valid email address.");
    }

    const pwErr = passwordError(ADMIN_PASSWORD, 10);

    if (pwErr) {
      throw new Error(`ADMIN_PASSWORD: ${pwErr}`);
    }

    console.log("Connecting to MongoDB...");

    await mongoose.connect(MONGODB_URI);

    console.log("MongoDB connected.");

    const email = ADMIN_EMAIL.trim().toLowerCase();
    const passwordHash = await hashPassword(ADMIN_PASSWORD);

    const admin = await User.findOneAndUpdate(
      { email },
      {
        $set: {
          name: ADMIN_NAME,
          email,
          passwordHash,
          role: "admin",
        },
        $unset: {
          resetTokenHash: 1,
          resetTokenExpires: 1,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );

    console.log(`Admin created/updated successfully: ${admin.email}`);
    console.log(`Role: ${admin.role}`);
  } catch (err) {
    console.error("Admin creation failed:");
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

createAdmin();
