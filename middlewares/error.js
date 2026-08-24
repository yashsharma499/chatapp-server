import { envMode } from "../app.js";

const errorMiddleware = (err, req, res, next) => {
  err.message ||= "Internal Server Error";
  err.statusCode ||= 500;

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {}).join(", ");
    err.message = field
      ? `That ${field} is already taken`
      : "Duplicate field value";
    err.statusCode = 400;
  }

  if (err.name === "CastError") {
    err.message = `Invalid format of ${err.path}`;
    err.statusCode = 400;
  }

  if (err.name === "ValidationError") {
    err.message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
    err.statusCode = 400;
  }

  // Multer surfaces oversized uploads as a code, not a friendly message.
  if (err.code === "LIMIT_FILE_SIZE") {
    err.message = "File is too large. Maximum size is 5MB.";
    err.statusCode = 400;
  }

  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    err.message = "Too many files. You can send at most 5 at a time.";
    err.statusCode = 400;
  }

  if (err.statusCode >= 500) console.error(err);

  const response = {
    success: false,
    message: err.message,
  };

  if (envMode === "DEVELOPMENT") response.error = err.stack;

  return res.status(err.statusCode).json(response);
};

const TryCatch = (passedFunc) => async (req, res, next) => {
  try {
    await passedFunc(req, res, next);
  } catch (error) {
    next(error);
  }
};

export { errorMiddleware, TryCatch };
