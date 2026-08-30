import express from "express";
import {
  allChats,
  allMessages,
  allUsers,
  getAdminData,
  getDashboardStats,
} from "../controllers/admin.js";
import { adminOnly, isAuthenticated } from "../middlewares/auth.js";

const app = express.Router();

// Admin is a property of the logged-in account (User.role === "admin"), so
// every route here needs a normal session first and then the role check.
// The old flow had a separate /verify endpoint that traded a shared secret for
// its own cookie, which meant admin access was not tied to any user at all.
app.use(isAuthenticated, adminOnly);

app.get("/", getAdminData);

app.get("/users", allUsers);
app.get("/chats", allChats);
app.get("/messages", allMessages);

app.get("/stats", getDashboardStats);

export default app;
