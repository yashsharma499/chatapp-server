import express from "express";
import {
  addMembers,
  deleteChat,
  deleteMessage,
  editMessage,
  getChatDetails,
  getMessages,
  getMyChats,
  getMyGroups,
  leaveGroup,
  markChatAsRead,
  newGroupChat,
  removeMember,
  renameGroup,
  searchMessages,
  sendAttachments,
} from "../controllers/chat.js";
import {
  addMemberValidator,
  chatIdValidator,
  editMessageValidator,
  messageIdValidator,
  newGroupValidator,
  removeMemberValidator,
  renameValidator,
  searchMessagesValidator,
  sendAttachmentsValidator,
  validateHandler,
} from "../lib/validators.js";
import { isAuthenticated } from "../middlewares/auth.js";
import { attachmentsMulter } from "../middlewares/multer.js";

const app = express.Router();

// After here user must be logged in to access the routes

app.use(isAuthenticated);

app.post("/new", newGroupValidator(), validateHandler, newGroupChat);

app.get("/my", getMyChats);

app.get("/my/groups", getMyGroups);

app.put("/addmembers", addMemberValidator(), validateHandler, addMembers);

app.put("/removemember", removeMemberValidator(), validateHandler, removeMember);

app.delete("/leave/:id", chatIdValidator(), validateHandler, leaveGroup);

// Send Attachments
app.post(
  "/message",
  attachmentsMulter,
  sendAttachmentsValidator(),
  validateHandler,
  sendAttachments
);

// Edit / delete a single message. Registered before the "/:id" chat routes so
// "message" is never mistaken for a chat id.
app.put(
  "/message/:id",
  editMessageValidator(),
  validateHandler,
  editMessage
);

app.delete(
  "/message/:id",
  messageIdValidator(),
  validateHandler,
  deleteMessage
);

// Get Messages
app.get("/message/:id", chatIdValidator(), validateHandler, getMessages);

app.get(
  "/search/:id",
  searchMessagesValidator(),
  validateHandler,
  searchMessages
);

app.put("/read/:id", chatIdValidator(), validateHandler, markChatAsRead);

// Get Chat Details, rename, delete
app
  .route("/:id")
  .get(chatIdValidator(), validateHandler, getChatDetails)
  .put(renameValidator(), validateHandler, renameGroup)
  .delete(chatIdValidator(), validateHandler, deleteChat);

export default app;
