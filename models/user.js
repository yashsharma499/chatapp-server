import mongoose, { Schema, model } from "mongoose";
import { hash, compare } from "bcrypt";

const schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },
    bio: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    avatar: {
      public_id: {
        type: String,
        required: true,
      },
      url: {
        type: String,
        required: true,
      },
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

schema.pre("save", async function (next) {
  // Guard: without this early return every profile update would re-hash an
  // already-hashed password and lock the user out.
  if (!this.isModified("password")) return next();

  this.password = await hash(this.password, 10);
  next();
});

schema.methods.comparePassword = function (candidate) {
  return compare(candidate, this.password);
};

export const User = mongoose.models.User || model("User", schema);
