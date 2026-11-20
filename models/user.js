const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose').default;

const ROLES = Object.freeze({ admin: 'Administrator', member: 'Member' });
// `attempts` and `last` (sign-in back-off of earlier versions) may remain in stored documents.
const PRIVATE_FIELDS = ['hash', 'salt', 'attempts', 'last', 'session_version'];

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'A username is required.'],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, 'The username must be at least 3 characters long.'],
      maxlength: [50, 'The username must be at most 50 characters long.'],
      match: [
        /^[a-z0-9._-]+$/,
        'The username may only contain letters, digits, dots, dashes and underscores.',
      ],
    },
    email: {
      type: String,
      required: [true, 'An email address is required.'],
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: [254, 'The email address is too long.'],
      match: [/^[^\s@]+@[^\s@]+$/, 'Enter a valid email address.'],
    },
    display_name: {
      type: String,
      trim: true,
      maxlength: [100, 'The display name must be at most 100 characters long.'],
    },
    role: { type: String, enum: Object.keys(ROLES), default: 'member', required: true },
    last_login_at: { type: Date },
    // Stored in every login session (config/passport.js); sessions with an older value are
    // signed out. Incremented whenever the password changes.
    session_version: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        for (const field of PRIVATE_FIELDS) delete ret[field];
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

// Failed sign-ins are rate limited per client IP (middleware/rateLimit.js), not per account:
// passport-local-mongoose's `limitAttempts` would let anyone who knows a username keep that
// account locked.
userSchema.plugin(passportLocalMongoose, {
  usernameLowerCase: true,
  usernameQueryFields: ['email'],
  // Pinned to the passport-local-mongoose v8 defaults so legacy password hashes keep verifying.
  saltlen: 32,
  iterations: 25000,
  keylen: 512,
  digestAlgorithm: 'sha256',
  encoding: 'hex',
});

// A new password (setPassword() / changePassword() followed by save()) ends all existing sessions.
userSchema.pre('save', function () {
  if (!this.isNew && this.isModified('hash')) this.$inc('session_version', 1);
});

userSchema.virtual('name').get(function () {
  return this.display_name || this.username;
});

userSchema.virtual('is_admin').get(function () {
  return this.role === 'admin';
});

const User = mongoose.model('User', userSchema);
User.ROLES = ROLES;

module.exports = User;
