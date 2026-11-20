const mongoose = require('mongoose');

function isBareFileName(value) {
  return !/[/\\\0]/.test(value) && value !== '.' && value !== '..';
}

const fileSchema = new mongoose.Schema(
  {
    stored_name: {
      type: String,
      required: true,
      validate: { validator: isBareFileName, message: 'The stored file name must not be a path.' },
    },
    original_name: { type: String, required: true, trim: true, maxlength: 255 },
    mime_type: { type: String, required: true, trim: true, maxlength: 255 },
    size: { type: Number, min: 0 },
  },
  { _id: false },
);

const documentInstanceSchema = new mongoose.Schema(
  {
    document: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    issued_at: { type: Date },
    expires_at: {
      type: Date,
      required: [true, 'The expiry date is required.'],
      index: true,
      validate: {
        // Only checked when validating a document (save/validate), not in update queries.
        validator(value) {
          if (!(this instanceof mongoose.Document)) return true;
          return !this.issued_at || !value || value >= this.issued_at;
        },
        message: 'The expiry date cannot be before the issue date.',
      },
    },
    file: { type: fileSchema, default: undefined },
    notes: {
      type: String,
      trim: true,
      maxlength: [2000, 'The notes must be at most 2000 characters long.'],
    },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

documentInstanceSchema.virtual('url').get(function () {
  return `/versions/${this._id}`;
});

documentInstanceSchema.virtual('download_url').get(function () {
  return `/versions/${this._id}/download`;
});

module.exports = mongoose.model('DocumentInstance', documentInstanceSchema);
