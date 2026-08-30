import jwt from "jsonwebtoken";
import { ErrorHandler } from "../utils/utility.js";
import { TryCatch } from "./error.js";
import { CHATTU_TOKEN } from "../constants/config.js";
import { User } from "../models/user.js";

const isAuthenticated = TryCatch((req, res, next) => {
  const token = req.cookies[CHATTU_TOKEN];
  if (!token)
    return next(new ErrorHandler("Please login to access this route", 401));

  let decodedData;
  try {
    decodedData = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    // Expired or tampered token: surface 401 so the client logs out cleanly
    // rather than bubbling a raw 500.
    return next(new ErrorHandler("Session expired, please login again", 401));
  }

  req.user = decodedData._id;

  next();
});

// Runs after isAuthenticated, so req.user is already the logged-in user's id.
// Admin is now a property of the account rather than a shared secret, which
// means access can be granted and revoked per user and every admin action is
// attributable to a real person.
const adminOnly = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user).select("role name username");

  if (!user)
    return next(new ErrorHandler("Please login to access this route", 401));

  if (user.role !== "admin")
    return next(
      new ErrorHandler("You do not have permission to access this area", 403)
    );

  req.adminUser = user;
  next();
});

const socketAuthenticator = async (err, socket, next) => {
  try {
    if (err) return next(err);

    const authToken = socket.request.cookies?.[CHATTU_TOKEN];

    if (!authToken)
      return next(new ErrorHandler("Please login to access this route", 401));

    const decodedData = jwt.verify(authToken, process.env.JWT_SECRET);

    const user = await User.findById(decodedData._id).select("name avatar");

    if (!user)
      return next(new ErrorHandler("Please login to access this route", 401));

    socket.user = user;

    return next();
  } catch {
    return next(new ErrorHandler("Please login to access this route", 401));
  }
};

export { isAuthenticated, adminOnly, socketAuthenticator };
