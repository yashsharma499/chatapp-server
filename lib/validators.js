import { body, param, query, validationResult } from "express-validator";
import { ErrorHandler } from "../utils/utility.js";

const validateHandler = (req, res, next) => {
  const errors = validationResult(req);

  if (errors.isEmpty()) return next();

  const errorMessages = errors
    .array()
    .map((error) => error.msg)
    .join(", ");

  next(new ErrorHandler(errorMessages, 400));
};

const registerValidator = () => [
  body("name", "Please enter your name").trim().notEmpty().isLength({ max: 60 }),
  body("username")
    .trim()
    .notEmpty()
    .withMessage("Please enter a username")
    .isLength({ min: 3, max: 30 })
    .withMessage("Username must be 3-30 characters")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage("Username may only contain letters, numbers and underscores"),
  body("bio", "Please enter a bio").trim().notEmpty().isLength({ max: 200 }),
  body("password")
    .notEmpty()
    .withMessage("Please enter a password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
];

const loginValidator = () => [
  body("username", "Please enter your username").trim().notEmpty(),
  body("password", "Please enter your password").notEmpty(),
];

const updateProfileValidator = () => [
  body("name")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Name cannot be empty")
    .isLength({ max: 60 }),
  body("bio").optional().trim().isLength({ max: 200 }),
];

const changePasswordValidator = () => [
  body("oldPassword", "Please enter your current password").notEmpty(),
  body("newPassword")
    .notEmpty()
    .withMessage("Please enter a new password")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters"),
];

const newGroupValidator = () => [
  body("name", "Please enter a group name")
    .trim()
    .notEmpty()
    .isLength({ max: 80 }),
  body("members")
    .isArray({ min: 2, max: 100 })
    .withMessage("A group needs 2-100 other members"),
  body("members.*").isMongoId().withMessage("Invalid member id"),
];

const addMemberValidator = () => [
  body("chatId", "Please provide a chat id").isMongoId(),
  body("members")
    .isArray({ min: 1, max: 97 })
    .withMessage("You can add 1-97 members at a time"),
  body("members.*").isMongoId().withMessage("Invalid member id"),
];

const removeMemberValidator = () => [
  body("chatId", "Please provide a chat id").isMongoId(),
  body("userId", "Please provide a user id").isMongoId(),
];

const sendAttachmentsValidator = () => [
  body("chatId", "Please provide a chat id").isMongoId(),
];

// isMongoId rather than notEmpty: an id like "abc" used to reach Mongoose and
// come back as a CastError 500 instead of a clean 400.
const chatIdValidator = () => [param("id", "Please provide a chat id").isMongoId()];

const messageIdValidator = () => [
  param("id", "Please provide a message id").isMongoId(),
];

const editMessageValidator = () => [
  param("id", "Please provide a message id").isMongoId(),
  body("content", "Message cannot be empty")
    .trim()
    .notEmpty()
    .isLength({ max: 5000 }),
];

const searchMessagesValidator = () => [
  param("id", "Please provide a chat id").isMongoId(),
  query("q").optional().trim().isLength({ max: 100 }),
];

const renameValidator = () => [
  param("id", "Please provide a chat id").isMongoId(),
  body("name", "Please enter a new name").trim().notEmpty().isLength({ max: 80 }),
];

const sendRequestValidator = () => [
  body("userId", "Please provide a user id").isMongoId(),
];

const acceptRequestValidator = () => [
  body("requestId", "Please provide a request id").isMongoId(),
  body("accept")
    .isBoolean()
    .withMessage("Accept must be a boolean"),
];

export {
  acceptRequestValidator,
  addMemberValidator,
  changePasswordValidator,
  chatIdValidator,
  editMessageValidator,
  loginValidator,
  messageIdValidator,
  newGroupValidator,
  registerValidator,
  removeMemberValidator,
  renameValidator,
  searchMessagesValidator,
  sendAttachmentsValidator,
  sendRequestValidator,
  updateProfileValidator,
  validateHandler,
};
