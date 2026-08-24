import { compare } from "bcrypt";
import { NEW_REQUEST, REFETCH_CHATS } from "../constants/events.js";
import { getOtherMember } from "../lib/helper.js";
import { TryCatch } from "../middlewares/error.js";
import { Chat } from "../models/chat.js";
import { Request } from "../models/request.js";
import { User } from "../models/user.js";
import {
  cookieOptions,
  deleteFilesFromCloudinary,
  emitEvent,
  sendToken,
  uploadFilesToCloudinary,
} from "../utils/features.js";
import { ErrorHandler } from "../utils/utility.js";
import { userSocketIDs } from "../app.js";

// Create a new user and save it to the database and save token in cookie
const newUser = TryCatch(async (req, res, next) => {
  const { name, username, password, bio } = req.body;

  const file = req.file;

  // The original omitted the status code here, so a missing avatar surfaced as
  // a 500 instead of a validation error.
  if (!file) return next(new ErrorHandler("Please upload an avatar", 400));

  const normalizedUsername = String(username).trim().toLowerCase();

  const existing = await User.findOne({ username: normalizedUsername });
  if (existing)
    return next(new ErrorHandler("That username is already taken", 409));

  const result = await uploadFilesToCloudinary([file]);

  const avatar = {
    public_id: result[0].public_id,
    url: result[0].url,
  };

  const user = await User.create({
    name,
    bio,
    username: normalizedUsername,
    password,
    avatar,
  });

  sendToken(res, user, 201, "Account created");
});

// Login user and save token in cookie
const login = TryCatch(async (req, res, next) => {
  const { username, password } = req.body;

  const user = await User.findOne({
    username: String(username).trim().toLowerCase(),
  }).select("+password");

  // 401 rather than 404, and the same message for both branches so the
  // response cannot be used to enumerate valid usernames.
  if (!user)
    return next(new ErrorHandler("Invalid username or password", 401));

  const isMatch = await compare(password, user.password);

  if (!isMatch)
    return next(new ErrorHandler("Invalid username or password", 401));

  sendToken(res, user, 200, `Welcome back, ${user.name}`);
});

const getMyProfile = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);

  if (!user) return next(new ErrorHandler("User not found", 404));

  res.status(200).json({
    success: true,
    user,
  });
});

const updateProfile = TryCatch(async (req, res, next) => {
  const { name, bio } = req.body;

  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User not found", 404));

  if (name !== undefined) user.name = String(name).trim();
  if (bio !== undefined) user.bio = String(bio).trim();

  if (req.file) {
    const oldPublicId = user.avatar?.public_id;

    const result = await uploadFilesToCloudinary([req.file]);
    user.avatar = {
      public_id: result[0].public_id,
      url: result[0].url,
    };

    // Reclaim the storage the replaced avatar was using.
    if (oldPublicId) await deleteFilesFromCloudinary([oldPublicId]);
  }

  await user.save();

  return res.status(200).json({
    success: true,
    user,
    message: "Profile updated",
  });
});

const changePassword = TryCatch(async (req, res, next) => {
  const { oldPassword, newPassword } = req.body;

  const user = await User.findById(req.user).select("+password");
  if (!user) return next(new ErrorHandler("User not found", 404));

  const isMatch = await compare(oldPassword, user.password);
  if (!isMatch)
    return next(new ErrorHandler("Current password is incorrect", 401));

  if (oldPassword === newPassword)
    return next(
      new ErrorHandler("New password must be different from the old one", 400)
    );

  // Assigning the plaintext is intentional — the pre("save") hook hashes it.
  user.password = newPassword;
  await user.save();

  return res.status(200).json({
    success: true,
    message: "Password changed successfully",
  });
});

const logout = TryCatch(async (req, res) => {
  return res
    .status(200)
    .cookie("chattu-token", "", { ...cookieOptions, maxAge: 0 })
    .json({
      success: true,
      message: "Logged out successfully",
    });
});

const searchUser = TryCatch(async (req, res) => {
  const { name = "" } = req.query;

  // Escape regex metacharacters so a search for "a+b" cannot blow up or turn
  // into an expensive backtracking pattern.
  const safeName = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Finding all my one-to-one chats
  const myChats = await Chat.find({ groupChat: false, members: req.user });

  // Everyone I already have a chat with
  const allUsersFromMyChats = myChats.flatMap((chat) => chat.members);

  // Exclude my existing contacts *and* myself. Self-exclusion previously relied
  // on appearing in one of my own chats, so a brand new account with no chats
  // yet found itself in its own search results.
  const allUsersExceptMeAndFriends = await User.find({
    _id: { $nin: [...allUsersFromMyChats, req.user] },
    name: { $regex: safeName, $options: "i" },
  }).limit(30);

  // Anyone I have a pending request with in either direction is not "findable"
  // again — showing an Add button that always errors was confusing.
  const pendingRequests = await Request.find({
    $or: [{ sender: req.user }, { receiver: req.user }],
  }).select("sender receiver");

  const pendingIds = new Set(
    pendingRequests.flatMap(({ sender, receiver }) => [
      sender.toString(),
      receiver.toString(),
    ])
  );

  const users = allUsersExceptMeAndFriends
    .filter((user) => !pendingIds.has(user._id.toString()))
    .map(({ _id, name, avatar }) => ({
      _id,
      name,
      avatar: avatar.url,
    }));

  return res.status(200).json({
    success: true,
    users,
  });
});

const sendFriendRequest = TryCatch(async (req, res, next) => {
  const { userId } = req.body;

  if (userId.toString() === req.user.toString())
    return next(new ErrorHandler("You cannot add yourself", 400));

  const target = await User.findById(userId).select("_id");
  if (!target) return next(new ErrorHandler("User not found", 404));

  // Already friends? Then a request is meaningless.
  const existingChat = await Chat.findOne({
    groupChat: false,
    members: { $all: [req.user, userId] },
  });

  if (existingChat)
    return next(new ErrorHandler("You are already friends", 400));

  const request = await Request.findOne({
    $or: [
      { sender: req.user, receiver: userId },
      { sender: userId, receiver: req.user },
    ],
  });

  if (request) return next(new ErrorHandler("Request already sent", 400));

  await Request.create({
    sender: req.user,
    receiver: userId,
  });

  emitEvent(req, NEW_REQUEST, [userId]);

  return res.status(200).json({
    success: true,
    message: "Friend request sent",
  });
});

const acceptFriendRequest = TryCatch(async (req, res, next) => {
  const { requestId, accept } = req.body;

  const request = await Request.findById(requestId)
    .populate("sender", "name")
    .populate("receiver", "name");

  if (!request) return next(new ErrorHandler("Request not found", 404));

  if (request.receiver._id.toString() !== req.user.toString())
    return next(
      new ErrorHandler("You are not authorized to accept this request", 401)
    );

  if (!accept) {
    await request.deleteOne();

    return res.status(200).json({
      success: true,
      message: "Friend request rejected",
    });
  }

  const members = [request.sender._id, request.receiver._id];

  await Promise.all([
    Chat.create({
      members,
      name: `${request.sender.name}-${request.receiver.name}`,
    }),
    request.deleteOne(),
  ]);

  emitEvent(req, REFETCH_CHATS, members);

  return res.status(200).json({
    success: true,
    message: "Friend request accepted",
    senderId: request.sender._id,
  });
});

const getMyNotifications = TryCatch(async (req, res) => {
  const requests = await Request.find({ receiver: req.user }).populate(
    "sender",
    "name avatar"
  );

  // A sender deleted since the request was made would crash the map below.
  const allRequests = requests
    .filter(({ sender }) => sender)
    .map(({ _id, sender, createdAt }) => ({
      _id,
      createdAt,
      sender: {
        _id: sender._id,
        name: sender.name,
        avatar: sender.avatar.url,
      },
    }));

  return res.status(200).json({
    success: true,
    allRequests,
  });
});

const getMyFriends = TryCatch(async (req, res, next) => {
  const chatId = req.query.chatId;

  const chats = await Chat.find({
    members: req.user,
    groupChat: false,
  }).populate("members", "name avatar");

  const friends = chats
    .map(({ members }) => {
      const otherUser = getOtherMember(members, req.user);
      // Skip orphaned chats whose other member no longer exists rather than
      // dereferencing undefined and 500-ing the whole request.
      if (!otherUser) return null;

      return {
        _id: otherUser._id,
        name: otherUser.name,
        avatar: otherUser.avatar.url,
      };
    })
    .filter(Boolean);

  if (chatId) {
    const chat = await Chat.findById(chatId);
    if (!chat) return next(new ErrorHandler("Chat not found", 404));

    const memberIds = new Set(chat.members.map((m) => m.toString()));

    const availableFriends = friends.filter(
      (friend) => !memberIds.has(friend._id.toString())
    );

    return res.status(200).json({
      success: true,
      friends: availableFriends,
    });
  }

  return res.status(200).json({
    success: true,
    friends,
  });
});

// Presence for the people I actually share a chat with.
const getOnlineFriends = TryCatch(async (req, res) => {
  const chats = await Chat.find({ members: req.user }).select("members");

  const contactIds = new Set();
  chats.forEach(({ members }) =>
    members.forEach((member) => {
      const id = member.toString();
      if (id !== req.user.toString()) contactIds.add(id);
    })
  );

  const online = [...contactIds].filter((id) => userSocketIDs.has(id));

  const offlineIds = [...contactIds].filter((id) => !userSocketIDs.has(id));
  const lastSeen = await User.find({ _id: { $in: offlineIds } }).select(
    "lastSeen"
  );

  return res.status(200).json({
    success: true,
    online,
    lastSeen: lastSeen.map(({ _id, lastSeen }) => ({ _id, lastSeen })),
  });
});

export {
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
};
