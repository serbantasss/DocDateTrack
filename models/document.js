const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema(
  {
    // Queries by owner use the { owner, category } compound index below.
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Owner', required: true },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
      index: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [2000, 'The notes must be at most 2000 characters long.'],
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

documentSchema.index({ owner: 1, category: 1 }, { unique: true });

documentSchema.virtual('url').get(function () {
  return `/documents/${this._id}`;
});

documentSchema.virtual('title').get(function () {
  const categoryName = this.category?.name;
  const ownerName = this.owner?.name;
  if (categoryName && ownerName) return `${categoryName} — ${ownerName}`;
  return categoryName || ownerName || 'Document';
});

module.exports = mongoose.model('Document', documentSchema);
