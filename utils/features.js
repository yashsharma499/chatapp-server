import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { v4 as uuid } from "uuid";
import { v2 as cloudinary } from "cloudinary";
import { getBase64, getSockets } from "../lib/helper.js";

// SameSite=None requires Secure, and Secure cookies are dropped by browsers on
// plain http. Hardcoding the production pair made local login impossible, so
// pick the pair that matches the environment we are actually running in.
const isProduction = (process.env.NODE_ENV || "")
  .trim()
  .toUpperCase()
  .startsWith("PROD");

const cookieOptions = {
  maxAge: 15 * 24 * 60 * 60 * 1000,
  sameSite: isProduction ? "none" : "lax",
  httpOnly: true,
  secure: isProduction,
};

const connectDB = async (uri) => {
  if (!uri) throw new Error("MONGO_URI is not set");

  const dbName = process.env.MONGO_DB_NAME || "Chattu";
  const connection = await mongoose.connect(uri, { dbName });

  console.log(`Connected to DB "${dbName}" at ${connection.connection.host}`);
  return connection;
};

const sendToken = (res, user, code, message) => {
  const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "15d",
  });

  // Never let the password hash ride along in the response body.
  const safeUser = user.toObject ? user.toObject() : { ...user };
  delete safeUser.password;

  return res.status(code).cookie("chattu-token", token, cookieOptions).json({
    success: true,
    user: safeUser,
    message,
  });
};

const emitEvent = (req, event, users, data) => {
  const io = req.app.get("io");
  if (!io) return;

  const usersSocket = getSockets(users);
  if (usersSocket.length === 0) return;

  io.to(usersSocket).emit(event, data);
};

const uploadFilesToCloudinary = async (files = []) => {
  const uploadPromises = files.map((file) => {
    return new Promise((resolve, reject) => {
      cloudinary.uploader.upload(
        getBase64(file),
        {
          resource_type: "auto",
          public_id: uuid(),
          folder: "chattu",
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        }
      );
    });
  });

  const results = await Promise.all(uploadPromises);

  return results.map((result) => ({
    public_id: result.public_id,
    url: result.secure_url,
    resource_type: result.resource_type,
  }));
};

// Previously a no-op, which meant every deleted chat leaked its attachments in
// Cloudinary forever. Deletion is best effort: a failure here must not abort
// the chat deletion the user asked for.
//
// Accepts either bare public_id strings or {public_id, resource_type} objects.
// resource_type matters: "auto" is only valid when uploading, and passing it
// to destroy() makes every call fail silently, so videos and raw files have to
// be deleted under their real type.
const deleteFilesFromCloudinary = async (files = []) => {
  const targets = files
    .map((file) =>
      typeof file === "string"
        ? { public_id: file, resource_type: "image" }
        : { public_id: file.public_id, resource_type: file.resource_type || "image" }
    )
    .filter((file) => file.public_id);

  if (targets.length === 0) return;

  const results = await Promise.allSettled(
    targets.map(({ public_id, resource_type }) =>
      cloudinary.uploader
        .destroy(public_id, { resource_type, invalidate: true })
        .then((result) => {
          // The API resolves with {result:"not found"} rather than rejecting.
          if (result?.result !== "ok" && result?.result !== "not found")
            throw new Error(`${public_id}: ${result?.result}`);
          return result;
        })
    )
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0)
    console.error(
      `Cloudinary cleanup: ${failed.length}/${targets.length} deletions failed`,
      failed.map((f) => f.reason?.message).join("; ")
    );
};

export {
  connectDB,
  sendToken,
  cookieOptions,
  emitEvent,
  deleteFilesFromCloudinary,
  uploadFilesToCloudinary,
  isProduction,
};
