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
    // Admin access is granted by flipping this field, e.g. in Atlas:
    //   db.users.updateOne({ username: "yash" }, { $set: { role: "admin" } })
    // It replaces the old shared ADMIN_SECRET_KEY, which let anyone who knew
    // one password read every private message without logging in at all.
    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
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
