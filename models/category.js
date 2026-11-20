const mongoose = require('mongoose');

const SCOPES = Object.freeze({ personal: 'Personal', company: 'Company', employee: 'Employee' });

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'The name is required.'],
      unique: true,
      trim: true,
      maxlength: [100, 'The name must be at most 100 characters long.'],
    },
    scope: {
      type: String,
      required: [true, 'The scope is required.'],
      enum: { values: Object.keys(SCOPES), message: 'Choose a valid scope.' },
      default: 'personal',
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'The description must be at most 500 characters long.'],
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

categorySchema.virtual('url').get(function () {
  return `/categories/${this._id}`;
});

const Category = mongoose.model('Category', categorySchema);
Category.SCOPES = SCOPES;

module.exports = Category;
