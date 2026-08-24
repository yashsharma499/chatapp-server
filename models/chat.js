import mongoose, { Schema, model, Types } from "mongoose";

const schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    groupChat: {
      type: Boolean,
      default: false,
    },
    creator: {
      type: Types.ObjectId,
      ref: "User",
    },
    members: [
      {
        type: Types.ObjectId,
        ref: "User",
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Every request path filters chats by membership, so this is the hot index.
schema.index({ members: 1 });
schema.index({ members: 1, groupChat: 1 });

// True when the given user id belongs to this chat. Written as an explicit
// string comparison because Array.prototype.includes compares ObjectId
// instances by reference and silently returns false for a string id.
schema.methods.hasMember = function (userId) {
  return this.members.some(
    (member) => member.toString() === userId.toString()
  );
};

export const Chat = mongoose.models.Chat || model("Chat", schema);
