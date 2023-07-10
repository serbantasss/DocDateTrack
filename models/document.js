const mongoose = require("mongoose");
const { DateTime } = require("luxon")
const Schema = mongoose.Schema;

const DocumentSchema = new Schema({
    owner: { type: Schema.Types.ObjectId, ref: "Owner", required: true },
    category: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    status: {
        type: String,
        enum: ["Updated", "Expired", "Update Soon"],
    },
});

// Virtual for document's URL
DocumentSchema.virtual("url").get(function () {
    return `/document/${this._id}`;
});

// Export model
module.exports = mongoose.model("Document", DocumentSchema);
