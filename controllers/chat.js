import { TryCatch } from "../middlewares/error.js";
import { ErrorHandler } from "../utils/utility.js";
import { Chat } from "../models/chat.js";
import {
  deleteFilesFromCloudinary,
  emitEvent,
  uploadFilesToCloudinary,
} from "../utils/features.js";
import {
  ALERT,
  MESSAGE_DELETED,
  MESSAGE_EDITED,
  MESSAGE_SEEN,
  NEW_MESSAGE,
  NEW_MESSAGE_ALERT,
  REFETCH_CHATS,
} from "../constants/events.js";
import { getOtherMember } from "../lib/helper.js";
import { User } from "../models/user.js";
import { Message } from "../models/message.js";

// Load a chat and assert the caller belongs to it. Almost every handler below
// needs this, and several of them previously skipped the check entirely.
const findChatForMember = async (chatId, userId) => {
  const chat = await Chat.findById(chatId);
  if (!chat) return { error: new ErrorHandler("Chat not found", 404) };

  if (!chat.hasMember(userId))
    return {
      error: new ErrorHandler("You are not a member of this chat", 403),
    };

  return { chat };
};

const newGroupChat = TryCatch(async (req, res, next) => {
  const { name, members } = req.body;

  // De-duplicate and drop the creator if the client also included them, so a
  // group cannot be created with the same person listed twice.
  const uniqueMembers = [
    ...new Set(members.map((m) => m.toString())),
  ].filter((m) => m !== req.user.toString());

  if (uniqueMembers.length < 2)
    return next(
      new ErrorHandler("A group needs at least 2 other members", 400)
    );

  const existingUsers = await User.find({ _id: { $in: uniqueMembers } }).select(
    "_id"
  );

  if (existingUsers.length !== uniqueMembers.length)
    return next(new ErrorHandler("One or more members do not exist", 400));

  const allMembers = [...uniqueMembers, req.user];

  const chat = await Chat.create({
    name,
    groupChat: true,
    creator: req.user,
    members: allMembers,
  });

  emitEvent(req, ALERT, allMembers, {
    chatId: chat._id,
    message: `Welcome to ${name}`,
  });
  emitEvent(req, REFETCH_CHATS, allMembers);

  return res.status(201).json({
    success: true,
    message: "Group created",
  });
});

const getMyChats = TryCatch(async (req, res, next) => {
  const chats = await Chat.find({ members: req.user })
    .populate("members", "name avatar")
    .sort({ updatedAt: -1 });

  // Fetch the newest message per chat in one aggregation so the list can show
  // a preview and order by real activity instead of by chat creation time.
  const chatIds = chats.map((chat) => chat._id);
  const lastMessages = await Message.aggregate([
    { $match: { chat: { $in: chatIds } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$chat",
        content: { $first: "$content" },
        attachments: { $first: "$attachments" },
        deletedAt: { $first: "$deletedAt" },
        sender: { $first: "$sender" },
        createdAt: { $first: "$createdAt" },
      },
    },
  ]);

  const lastMessageByChat = new Map(
    lastMessages.map((m) => [m._id.toString(), m])
  );

  const transformedChats = chats.map(({ _id, name, members, groupChat }) => {
    const otherMember = getOtherMember(members, req.user);
    const last = lastMessageByChat.get(_id.toString());

    let preview = "";
    if (last) {
      if (last.deletedAt) preview = "This message was deleted";
      else if (last.content) preview = last.content;
      else if (last.attachments?.length) preview = "📎 Attachment";
    }

    return {
      _id,
      groupChat,
      avatar: groupChat
        ? members.slice(0, 3).map(({ avatar }) => avatar.url)
        : // A one-to-one chat whose partner was deleted has no other member.
          [otherMember?.avatar?.url].filter(Boolean),
      name: groupChat ? name : otherMember?.name || "Deleted user",
      lastMessage: preview,
      lastMessageAt: last?.createdAt || null,
      members: members.reduce((prev, curr) => {
        if (curr._id.toString() !== req.user.toString()) prev.push(curr._id);
        return prev;
      }, []),
    };
  });

  // Newest conversation first.
  transformedChats.sort(
    (a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0)
  );

  return res.status(200).json({
    success: true,
    chats: transformedChats,
  });
});

const getMyGroups = TryCatch(async (req, res, next) => {
  const chats = await Chat.find({
    members: req.user,
    groupChat: true,
    creator: req.user,
  }).populate("members", "name avatar");

  const groups = chats.map(({ members, _id, groupChat, name }) => ({
    _id,
    groupChat,
    name,
    totalMembers: members.length,
    avatar: members.slice(0, 3).map(({ avatar }) => avatar.url),
  }));

  return res.status(200).json({
    success: true,
    groups,
  });
});

const addMembers = TryCatch(async (req, res, next) => {
  const { chatId, members } = req.body;

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (!chat.groupChat)
    return next(new ErrorHandler("This is not a group chat", 400));

  if (chat.creator.toString() !== req.user.toString())
    return next(new ErrorHandler("You are not allowed to add members", 403));

  const allNewMembers = await User.find({ _id: { $in: members } }).select(
    "name"
  );

  if (allNewMembers.length === 0)
    return next(new ErrorHandler("No valid users to add", 400));

  const existingIds = new Set(chat.members.map((m) => m.toString()));

  // The old filter compared ObjectId values against strings with
  // Array.includes, which is always false — so re-adding an existing member
  // silently duplicated them in the group.
  const uniqueMembers = allNewMembers.filter(
    (user) => !existingIds.has(user._id.toString())
  );

  if (uniqueMembers.length === 0)
    return next(new ErrorHandler("Those users are already in the group", 400));

  // Check the limit *before* mutating so a rejected request cannot leave the
  // in-memory document out of step with the database.
  if (chat.members.length + uniqueMembers.length > 100)
    return next(new ErrorHandler("Group members limit reached", 400));

  chat.members.push(...uniqueMembers.map((user) => user._id));

  await chat.save();

  const allUsersName = uniqueMembers.map((user) => user.name).join(", ");

  emitEvent(req, ALERT, chat.members, {
    chatId,
    message: `${allUsersName} ${
      uniqueMembers.length > 1 ? "were" : "was"
    } added to the group`,
  });

  emitEvent(req, REFETCH_CHATS, chat.members);

  return res.status(200).json({
    success: true,
    message: "Members added successfully",
  });
});

const removeMember = TryCatch(async (req, res, next) => {
  const { userId, chatId } = req.body;

  const [chat, userThatWillBeRemoved] = await Promise.all([
    Chat.findById(chatId),
    User.findById(userId, "name"),
  ]);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));
  if (!userThatWillBeRemoved)
    return next(new ErrorHandler("User not found", 404));

  if (!chat.groupChat)
    return next(new ErrorHandler("This is not a group chat", 400));

  if (chat.creator.toString() !== req.user.toString())
    return next(new ErrorHandler("You are not allowed to remove members", 403));

  if (userId.toString() === chat.creator.toString())
    return next(
      new ErrorHandler("The group creator cannot be removed", 400)
    );

  if (!chat.hasMember(userId))
    return next(new ErrorHandler("That user is not in this group", 400));

  if (chat.members.length <= 3)
    return next(new ErrorHandler("Group must have at least 3 members", 400));

  const allChatMembers = chat.members.map((i) => i.toString());

  chat.members = chat.members.filter(
    (member) => member.toString() !== userId.toString()
  );

  await chat.save();

  emitEvent(req, ALERT, chat.members, {
    message: `${userThatWillBeRemoved.name} was removed from the group`,
    chatId,
  });

  emitEvent(req, REFETCH_CHATS, allChatMembers);

  return res.status(200).json({
    success: true,
    message: "Member removed successfully",
  });
});

const leaveGroup = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (!chat.groupChat)
    return next(new ErrorHandler("This is not a group chat", 400));

  if (!chat.hasMember(req.user))
    return next(new ErrorHandler("You are not a member of this group", 403));

  const remainingMembers = chat.members.filter(
    (member) => member.toString() !== req.user.toString()
  );

  if (remainingMembers.length < 3)
    return next(new ErrorHandler("Group must have at least 3 members", 400));

  if (chat.creator.toString() === req.user.toString()) {
    const randomElement = Math.floor(Math.random() * remainingMembers.length);
    chat.creator = remainingMembers[randomElement];
  }

  const previousMembers = chat.members.map((m) => m.toString());
  chat.members = remainingMembers;

  const [user] = await Promise.all([
    User.findById(req.user, "name"),
    chat.save(),
  ]);

  emitEvent(req, ALERT, chat.members, {
    chatId,
    message: `${user.name} left the group`,
  });

  // Without this the leaver's own sidebar kept showing the group until a
  // manual refresh.
  emitEvent(req, REFETCH_CHATS, previousMembers);

  return res.status(200).json({
    success: true,
    message: "Left group successfully",
  });
});

const sendAttachments = TryCatch(async (req, res, next) => {
  const { chatId } = req.body;

  const files = req.files || [];

  if (files.length < 1)
    return next(new ErrorHandler("Please upload attachments", 400));

  if (files.length > 5)
    return next(new ErrorHandler("You can send at most 5 files", 400));

  // Membership was never verified here, so any logged-in user could post
  // attachments into any chat whose id they knew.
  const { chat, error } = await findChatForMember(chatId, req.user);
  if (error) return next(error);

  const me = await User.findById(req.user, "name avatar");

  const attachments = await uploadFilesToCloudinary(files);

  const saved = await Message.create({
    content: "",
    attachments,
    sender: me._id,
    chat: chatId,
    readBy: [me._id],
  });

  const message = {
    ...saved.toObject(),
    sender: {
      _id: me._id,
      name: me.name,
      avatar: me.avatar,
    },
  };

  emitEvent(req, NEW_MESSAGE, chat.members, { message, chatId });

  const others = chat.members
    .map((m) => m.toString())
    .filter((m) => m !== req.user.toString());
  emitEvent(req, NEW_MESSAGE_ALERT, others, { chatId });

  return res.status(200).json({
    success: true,
    message,
  });
});

const getChatDetails = TryCatch(async (req, res, next) => {
  const chat = await Chat.findById(req.params.id);
  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (!chat.hasMember(req.user))
    return next(new ErrorHandler("You are not a member of this chat", 403));

  if (req.query.populate === "true") {
    const populated = await Chat.findById(req.params.id)
      .populate("members", "name avatar")
      .lean();

    populated.members = populated.members.map(({ _id, name, avatar }) => ({
      _id,
      name,
      avatar: avatar.url,
    }));

    return res.status(200).json({ success: true, chat: populated });
  }

  return res.status(200).json({ success: true, chat });
});

const renameGroup = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;
  const { name } = req.body;

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  if (!chat.groupChat)
    return next(new ErrorHandler("This is not a group chat", 400));

  if (chat.creator.toString() !== req.user.toString())
    return next(
      new ErrorHandler("You are not allowed to rename the group", 403)
    );

  chat.name = name.trim();

  await chat.save();

  emitEvent(req, REFETCH_CHATS, chat.members);

  return res.status(200).json({
    success: true,
    message: "Group renamed successfully",
  });
});

const deleteChat = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;

  const chat = await Chat.findById(chatId);

  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  const members = chat.members.map((m) => m.toString());

  if (chat.groupChat && chat.creator.toString() !== req.user.toString())
    return next(
      new ErrorHandler("You are not allowed to delete the group", 403)
    );

  // hasMember() replaces an Array.includes() check that compared ObjectIds to
  // a string and therefore rejected every legitimate one-to-one deletion.
  if (!chat.groupChat && !chat.hasMember(req.user))
    return next(
      new ErrorHandler("You are not allowed to delete the chat", 403)
    );

  const messagesWithAttachments = await Message.find({
    chat: chatId,
    attachments: { $exists: true, $ne: [] },
  }).select("attachments");

  const attachmentsToDelete = messagesWithAttachments.flatMap(
    ({ attachments }) =>
      attachments.map(({ public_id, resource_type }) => ({
        public_id,
        resource_type,
      }))
  );

  await Promise.all([
    deleteFilesFromCloudinary(attachmentsToDelete),
    chat.deleteOne(),
    Message.deleteMany({ chat: chatId }),
  ]);

  emitEvent(req, REFETCH_CHATS, members);

  return res.status(200).json({
    success: true,
    message: "Chat deleted successfully",
  });
});

const getMessages = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;
  const page = Math.max(1, Number(req.query.page) || 1);

  const resultPerPage = 20;
  const skip = (page - 1) * resultPerPage;

  const { error } = await findChatForMember(chatId, req.user);
  if (error) return next(error);

  const [messages, totalMessagesCount] = await Promise.all([
    Message.find({ chat: chatId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(resultPerPage)
      .populate("sender", "name avatar")
      .populate({
        path: "replyTo",
        select: "content sender attachments deletedAt",
        populate: { path: "sender", select: "name" },
      })
      .lean(),
    Message.countDocuments({ chat: chatId }),
  ]);

  const totalPages = Math.ceil(totalMessagesCount / resultPerPage) || 0;

  return res.status(200).json({
    success: true,
    messages: messages.reverse(),
    totalPages,
  });
});

const editMessage = TryCatch(async (req, res, next) => {
  const { content } = req.body;
  const messageId = req.params.id;

  const message = await Message.findById(messageId);
  if (!message) return next(new ErrorHandler("Message not found", 404));

  if (message.sender.toString() !== req.user.toString())
    return next(new ErrorHandler("You can only edit your own messages", 403));

  if (message.deletedAt)
    return next(new ErrorHandler("This message was deleted", 400));

  if (message.attachments.length > 0)
    return next(new ErrorHandler("Attachments cannot be edited", 400));

  message.content = content.trim();
  message.editedAt = new Date();
  await message.save();

  const chat = await Chat.findById(message.chat).select("members");

  emitEvent(req, MESSAGE_EDITED, chat.members, {
    chatId: message.chat,
    messageId: message._id,
    content: message.content,
    editedAt: message.editedAt,
  });

  return res.status(200).json({
    success: true,
    message: "Message updated",
  });
});

const deleteMessage = TryCatch(async (req, res, next) => {
  const messageId = req.params.id;

  const message = await Message.findById(messageId);
  if (!message) return next(new ErrorHandler("Message not found", 404));

  const chat = await Chat.findById(message.chat).select("members creator");
  if (!chat) return next(new ErrorHandler("Chat not found", 404));

  const isAuthor = message.sender.toString() === req.user.toString();
  const isGroupOwner = chat.creator?.toString() === req.user.toString();

  if (!isAuthor && !isGroupOwner)
    return next(
      new ErrorHandler("You are not allowed to delete this message", 403)
    );

  if (message.attachments.length > 0)
    await deleteFilesFromCloudinary(
      message.attachments.map(({ public_id, resource_type }) => ({
        public_id,
        resource_type,
      }))
    );

  // Soft delete keeps the conversation order intact and lets every client
  // render a "deleted" placeholder rather than silently losing a bubble.
  message.deletedAt = new Date();
  message.content = "";
  message.attachments = [];
  await message.save();

  emitEvent(req, MESSAGE_DELETED, chat.members, {
    chatId: message.chat,
    messageId: message._id,
  });

  return res.status(200).json({
    success: true,
    message: "Message deleted",
  });
});

const markChatAsRead = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;

  const { chat, error } = await findChatForMember(chatId, req.user);
  if (error) return next(error);

  await Message.updateMany(
    { chat: chatId, readBy: { $ne: req.user } },
    { $addToSet: { readBy: req.user } }
  );

  emitEvent(req, MESSAGE_SEEN, chat.members, {
    chatId,
    userId: req.user,
  });

  return res.status(200).json({ success: true });
});

const searchMessages = TryCatch(async (req, res, next) => {
  const chatId = req.params.id;
  const { q = "" } = req.query;

  const term = String(q).trim();
  if (!term)
    return res.status(200).json({ success: true, messages: [] });

  const { error } = await findChatForMember(chatId, req.user);
  if (error) return next(error);

  const safeTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const messages = await Message.find({
    chat: chatId,
    deletedAt: null,
    content: { $regex: safeTerm, $options: "i" },
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("sender", "name avatar")
    .lean();

  return res.status(200).json({
    success: true,
    messages,
  });
});

export {
  newGroupChat,
  getMyChats,
  getMyGroups,
  addMembers,
  removeMember,
  leaveGroup,
  sendAttachments,
  getChatDetails,
  renameGroup,
  deleteChat,
  getMessages,
  editMessage,
  deleteMessage,
  markChatAsRead,
  searchMessages,
};
