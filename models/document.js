const mongoose = require("mongoose");
const { DateTime } = require("luxon")
const Schema = mongoose.Schema;

const DocumentSchema = new Schema({
    owner: { type: Schema.Types.ObjectId, ref: "Owner", required: true },
    category: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    status: {
        type: String,
        enum: ["Updated", "Expired", "Update Soon"],
        default: "Updated",
    },
    expire_date_raw: { type: Date, required: true},
    update_date_raw: { type: Date, default: Date.now },
    document_file:{
        data: Buffer,
        contentType: String,
    }
});

// Virtual for document's URL
DocumentSchema.virtual("url").get(function () {
    return `/document/${this._id}`;
});

//Virtual for formatted expire date
DocumentSchema.virtual("expire_date").get(function(){
    return DateTime.fromJSDate(this.expire_date_raw).toLocaleString(DateTime.DATE_MED);
})

//Virtual for formatted update date
DocumentSchema.virtual("update_date").get(function(){
    return DateTime.fromJSDate(this.update_date_raw).toLocaleString(DateTime.DATE_MED);
})

// Export model
module.exports = mongoose.model("Document", DocumentSchema);
