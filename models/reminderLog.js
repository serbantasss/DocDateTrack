const mongoose = require('mongoose');

const STAGES = Object.freeze(['expiring', 'expired']);

/**
 * Records that `recipient` was emailed about a document version reaching a stage. Written only
 * after the email was sent, so failed sends are retried by the next run.
 */
const reminderLogSchema = new mongoose.Schema(
  {
    recipient: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    document: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
    version: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentInstance', required: true },
    stage: { type: String, required: true, enum: STAGES },
    // Part of the key, so correcting the expiry date of a version starts its reminders over.
    expires_at: { type: Date, required: true },
    sent_at: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

reminderLogSchema.index({ version: 1, recipient: 1, stage: 1, expires_at: 1 }, { unique: true });

const ReminderLog = mongoose.model('ReminderLog', reminderLogSchema);
ReminderLog.STAGES = STAGES;

module.exports = ReminderLog;
