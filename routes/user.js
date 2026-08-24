import express from "express";
import {
  acceptFriendRequest,
  changePassword,
  getMyFriends,
  getMyNotifications,
  getMyProfile,
  getOnlineFriends,
  login,
  logout,
  newUser,
  searchUser,
  sendFriendRequest,
  updateProfile,
} from "../controllers/user.js";
import {
  acceptRequestValidator,
  changePasswordValidator,
  loginValidator,
  registerValidator,
  sendRequestValidator,
  updateProfileValidator,
  validateHandler,
} from "../lib/validators.js";
import { isAuthenticated } from "../middlewares/auth.js";
import { singleAvatar } from "../middlewares/multer.js";

const app = express.Router();

app.post("/new", singleAvatar, registerValidator(), validateHandler, newUser);
app.post("/login", loginValidator(), validateHandler, login);

// After here user must be logged in to access the routes

app.use(isAuthenticated);

app.get("/me", getMyProfile);

app.put(
  "/me",
  singleAvatar,
  updateProfileValidator(),
  validateHandler,
  updateProfile
);

app.put(
  "/password",
  changePasswordValidator(),
  validateHandler,
  changePassword
);

app.get("/logout", logout);

app.get("/search", searchUser);

app.put(
  "/sendrequest",
  sendRequestValidator(),
  validateHandler,
  sendFriendRequest
);

app.put(
  "/acceptrequest",
  acceptRequestValidator(),
  validateHandler,
  acceptFriendRequest
);

app.get("/notifications", getMyNotifications);

app.get("/friends", getMyFriends);

app.get("/presence", getOnlineFriends);

export default app;
