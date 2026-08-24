import { userSocketIDs } from "../app.js";

export const getOtherMember = (members, userId) =>
  members.find((member) => member._id.toString() !== userId.toString());

// Resolve user ids to live socket ids. A user may have several tabs open, and
// offline users have none — returning `undefined` entries here made
// io.to(sockets) fan out incorrectly, so flatten and drop the blanks.
export const getSockets = (users = []) =>
  users.flatMap((user) => {
    const sockets = userSocketIDs.get(user.toString());
    return sockets ? Array.from(sockets) : [];
  });

export const getBase64 = (file) =>
  `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
