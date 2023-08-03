const mongoose = require("mongoose");
const { DateTime } = require("luxon");
const Schema = mongoose.Schema;
const autopopulate = require('mongoose-autopopulate');

const DocumentSchema = new Schema({
    owner: { type: Schema.Types.ObjectId, ref: "Owner", required: true },
    category: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    status: {
        type: String,
        enum: ["Updated", "Expired", "Update Soon"],
    },
});

DocumentSchema.virtual('ownerData', {
    ref: 'Owner',
    localField: 'owner',
    foreignField: '_id',
    justOne: true,
    autopopulate: { maxDepth: 1 },
});

DocumentSchema.virtual('categoryData', {
    ref: 'Category',
    localField: 'category',
    foreignField: '_id',
    justOne: true,
    autopopulate: { select: 'name' },
});

DocumentSchema.virtual('name').get(function (){
    return `${this.categoryData.name}-${this.ownerData.last_name}_${this.ownerData.first_name}`;
})
// Virtual for document's URL
DocumentSchema.virtual("url").get(function () {
    return `/document/${this._id}`;
});

// Apply the autopopulate plugin to the schema
DocumentSchema.plugin(autopopulate);

// Export model
module.exports = mongoose.model("Document", DocumentSchema);
