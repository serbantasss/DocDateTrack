const mongoose = require('mongoose');

const ownerSchema = new mongoose.Schema(
  {
    first_name: {
      type: String,
      required: [true, 'The first name is required.'],
      trim: true,
      maxlength: [100, 'The first name must be at most 100 characters long.'],
    },
    last_name: {
      type: String,
      required: [true, 'The last name is required.'],
      trim: true,
      maxlength: [100, 'The last name must be at most 100 characters long.'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: [254, 'The email address is too long.'],
      match: [/^[^\s@]+@[^\s@]+$/, 'Enter a valid email address.'],
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [40, 'The phone number must be at most 40 characters long.'],
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [2000, 'The notes must be at most 2000 characters long.'],
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

ownerSchema.index({ last_name: 1, first_name: 1 });

ownerSchema.virtual('name').get(function () {
  return `${this.first_name} ${this.last_name}`;
});

ownerSchema.virtual('sort_name').get(function () {
  return `${this.last_name}, ${this.first_name}`;
});

ownerSchema.virtual('url').get(function () {
  return `/owners/${this._id}`;
});

module.exports = mongoose.model('Owner', ownerSchema);
