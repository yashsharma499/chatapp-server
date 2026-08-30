// MUST be the first import. ESM hoists every `import` above ordinary
// statements, so calling dotenv.config() lower down ran *after* modules like
// constants/config.js had already evaluated `process.env.CLIENT_URL` as
// undefined — which is why the deployed frontend origin never made it into the
// CORS allowlist. Importing "dotenv/config" here loads .env during the import
// phase, before any of our own modules are evaluated.
import "dotenv/config";

import express from "express";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import { createServer } from "http";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { v2 as cloudinary } from "cloudinary";

import { connectDB } from "./utils/features.js";
import { errorMiddleware } from "./middlewares/error.js";
import {
  CHAT_JOINED,
  CHAT_LEAVED,
  MESSAGE_ACK,
  MESSAGE_ERROR,
  NEW_MESSAGE,
  NEW_MESSAGE_ALERT,
  ONLINE_USERS,
  START_TYPING,
  STOP_TYPING,
} from "./constants/events.js";
import { getSockets } from "./lib/helper.js";
import { Message } from "./models/message.js";
import { Chat } from "./models/chat.js";
import { User } from "./models/user.js";
import { corsOptions } from "./constants/config.js";
import { socketAuthenticator } from "./middlewares/auth.js";

import userRoute from "./routes/user.js";
import chatRoute from "./routes/chat.js";
import adminRoute from "./routes/admin.js";

const mongoURI = process.env.MONGO_URI;
const port = process.env.PORT || 3000;
// Defaulting before .trim() — reading .trim() off an unset NODE_ENV threw a
// TypeError and crashed the process on boot.
const envMode = (process.env.NODE_ENV || "PRODUCTION").trim().toUpperCase();

if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is not set. Refusing to start.");
  process.exit(1);
}

// userId -> Set of socket ids, so a user with several tabs open stays online
// until the last one closes.
const userSocketIDs = new Map();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: corsOptions,
  pingTimeout: 60000,
});

app.set("io", io);
// Render terminates TLS at its proxy; without this express sees every request
// as http and the rate limiter sees every client as the same IP.
app.set("trust proxy", 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(cors(corsOptions));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please slow down." },
});

// Credential endpoints get a much tighter budget than ordinary reads. Each
// gets its OWN limiter instance: a single shared instance keeps one counter
// per IP across every route it is mounted on, so failed logins would eat the
// signup and admin budgets too.
const credentialLimiter = (max, windowMs, options = {}) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: "Too many attempts. Please try again in a few minutes.",
    },
    ...options,
  });

app.use("/api", apiLimiter);
// Only failed attempts count, so a legitimate user is never locked out.
app.use(
  "/api/v1/user/login",
  credentialLimiter(15, 15 * 60 * 1000, { skipSuccessfulRequests: true })
);
// Signups count every attempt, not just failures. Kept generous because many
// legitimate users share one public IP behind office/campus NAT.
app.use("/api/v1/user/new", credentialLimiter(30, 60 * 60 * 1000));

app.use("/api/v1/user", userRoute);
app.use("/api/v1/chat", chatRoute);
app.use("/api/v1/admin", adminRoute);

// Render's health check and uptime pingers hit this. It reports the database
// state explicitly: the process can be listening while Mongo is unreachable,
// and a silent 200 in that state hides a broken deployment.
const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

app.get("/health", (req, res) => {
  const readyState = mongoose.connection.readyState;
  const dbConnected = readyState === 1;

  res.status(dbConnected ? 200 : 503).json({
    success: dbConnected,
    status: dbConnected ? "ok" : "degraded",
    database: DB_STATES[readyState] || "unknown",
    uptime: process.uptime(),
    env: envMode,
  });
});

app.get("/", (req, res) => res.send("Chattu API is running"));

app.use((req, res) =>
  res.status(404).json({ success: false, message: "Route not found" })
);

app.use(errorMiddleware);

io.use((socket, next) => {
  cookieParser()(
    socket.request,
    socket.request.res,
    async (err) => await socketAuthenticator(err, socket, next)
  );
});

const broadcastOnlineUsers = () =>
  io.emit(ONLINE_USERS, Array.from(userSocketIDs.keys()));

// The client sends the member list it happens to have cached. Trusting it let
// anyone deliver a message into any socket, so every socket handler re-reads
// the authoritative membership from the database instead.
const getAuthorizedChat = async (chatId, userId) => {
  if (!chatId) return null;

  const chat = await Chat.findById(chatId).select("members").lean();
  if (!chat) return null;

  const isMember = chat.members.some(
    (member) => member.toString() === userId.toString()
  );

  return isMember ? chat : null;
};

io.on("connection", (socket) => {
  const user = socket.user;
  const userId = user._id.toString();

  if (!userSocketIDs.has(userId)) userSocketIDs.set(userId, new Set());
  userSocketIDs.get(userId).add(socket.id);

  broadcastOnlineUsers();

  socket.on(NEW_MESSAGE, async ({ chatId, message, replyTo, tempId }) => {
    try {
      const content = typeof message === "string" ? message.trim() : "";

      if (!content)
        return socket.emit(MESSAGE_ERROR, {
          tempId,
          message: "Message cannot be empty",
        });

      if (content.length > 5000)
        return socket.emit(MESSAGE_ERROR, {
          tempId,
          message: "Message is too long",
        });

      const chat = await getAuthorizedChat(chatId, userId);
      if (!chat)
        return socket.emit(MESSAGE_ERROR, {
          tempId,
          message: "You are not a member of this chat",
        });

      // Persist first so the id every client sees is the real one. The old
      // flow broadcast a throwaway uuid, which made edit, delete and read
      // receipts impossible to wire up against the stored document.
      const saved = await Message.create({
        content,
        sender: user._id,
        chat: chatId,
        replyTo: replyTo || null,
        readBy: [user._id],
      });

      const populated = await Message.findById(saved._id)
        .populate("sender", "name avatar")
        .populate({
          path: "replyTo",
          select: "content sender attachments deletedAt",
          populate: { path: "sender", select: "name" },
        })
        .lean();

      const members = chat.members.map((member) => member.toString());
      const membersSocket = getSockets(members);

      io.to(membersSocket).emit(NEW_MESSAGE, {
        chatId,
        message: populated,
      });

      // Only the recipients need an unread badge, not the author.
      const others = members.filter((member) => member !== userId);
      io.to(getSockets(others)).emit(NEW_MESSAGE_ALERT, { chatId });

      socket.emit(MESSAGE_ACK, { tempId, message: populated });
    } catch (error) {
      // An uncaught throw in here used to take the whole process down.
      console.error("NEW_MESSAGE failed:", error);
      socket.emit(MESSAGE_ERROR, { tempId, message: "Failed to send message" });
    }
  });

  socket.on(START_TYPING, async ({ chatId }) => {
    const chat = await getAuthorizedChat(chatId, userId);
    if (!chat) return;

    const others = chat.members
      .map((member) => member.toString())
      .filter((member) => member !== userId);

    io.to(getSockets(others)).emit(START_TYPING, {
      chatId,
      user: { _id: userId, name: user.name },
    });
  });

  socket.on(STOP_TYPING, async ({ chatId }) => {
    const chat = await getAuthorizedChat(chatId, userId);
    if (!chat) return;

    const others = chat.members
      .map((member) => member.toString())
      .filter((member) => member !== userId);

    io.to(getSockets(others)).emit(STOP_TYPING, {
      chatId,
      user: { _id: userId, name: user.name },
    });
  });

  socket.on(CHAT_JOINED, () => broadcastOnlineUsers());
  socket.on(CHAT_LEAVED, () => broadcastOnlineUsers());

  socket.on("disconnect", async () => {
    const sockets = userSocketIDs.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      // Only genuinely offline once every tab is gone.
      if (sockets.size === 0) {
        userSocketIDs.delete(userId);
        await User.findByIdAndUpdate(userId, { lastSeen: new Date() }).catch(
          () => {}
        );
      }
    }

    broadcastOnlineUsers();
  });
});

const start = async () => {
  // A missing URI is a config error that retrying cannot fix.
  if (!mongoURI) {
    console.error("FATAL: MONGO_URI is not set. Refusing to start.");
    process.exit(1);
  }

  // Bind the port BEFORE connecting to Mongo. Waiting for the database meant a
  // transient DNS blip (or a paused Atlas cluster) left the port unbound,
  // which Render reports as "No open ports detected" and treats as a failed
  // deploy. Now the service comes up, /health reports the database as down,
  // and the connection is retried in the background until it succeeds.
  server.listen(port, () =>
    console.log(`Server listening on port ${port} in ${envMode} Mode`)
  );

  let attempt = 0;

  const connectWithRetry = async () => {
    attempt += 1;
    try {
      await connectDB(mongoURI);
      attempt = 0;
    } catch (error) {
      // Exponential backoff, capped at 30s.
      const delay = Math.min(30000, 2000 * 2 ** Math.min(attempt - 1, 4));
      console.error(
        `MongoDB connection failed (attempt ${attempt}): ${error.message}. Retrying in ${
          delay / 1000
        }s`
      );
      setTimeout(connectWithRetry, delay).unref();
    }
  };

  connectWithRetry();
};

start();

// Render restarts the container on exit; log the cause instead of dying silently.
process.on("unhandledRejection", (reason) =>
  console.error("Unhandled rejection:", reason)
);
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

const shutdown = (signal) => () => {
  console.log(`${signal} received, shutting down gracefully`);
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on("SIGTERM", shutdown("SIGTERM"));
process.on("SIGINT", shutdown("SIGINT"));

export { envMode, userSocketIDs, io };
