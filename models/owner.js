const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const OwnerSchema = new Schema({
    first_name: { type: String, required: true, maxLength: 100 },
    last_name: { type: String, required: true, maxLength: 100 },
    phone: { type: String },
    email: { type: String, required: true },
});

// Virtual for author's full name
OwnerSchema.virtual("name").get(function () {
    return `${this.last_name} ${this.first_name}`;
});

// Virtual for author's URL
OwnerSchema.virtual("url").get(function () {
    return `/owner/${this._id}`;
});

// Export model
module.exports = mongoose.model("Owner", OwnerSchema);
