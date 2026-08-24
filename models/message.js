import mongoose, { Schema, model, Types } from "mongoose";

const schema = new Schema(
  {
    content: {
      type: String,
      default: "",
      maxlength: 5000,
    },

    attachments: [
      {
        public_id: {
          type: String,
          required: true,
        },
        url: {
          type: String,
          required: true,
        },
        // Needed at deletion time: Cloudinary's destroy() must be called with
        // the same resource type the asset was stored under.
        resource_type: {
          type: String,
          default: "image",
        },
      },
    ],

    sender: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
    chat: {
      type: Types.ObjectId,
      ref: "Chat",
      required: true,
    },

    // Quoted message this one replies to.
    replyTo: {
      type: Types.ObjectId,
      ref: "Message",
      default: null,
    },

    editedAt: {
      type: Date,
      default: null,
    },

    // Soft delete so the bubble can render "This message was deleted" for
    // everyone instead of leaving a hole in the conversation.
    deletedAt: {
      type: Date,
      default: null,
    },

    readBy: [
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

// Message history is always paged by chat, newest first.
schema.index({ chat: 1, createdAt: -1 });
schema.index({ chat: 1, readBy: 1 });

export const Message = mongoose.models.Message || model("Message", schema);
