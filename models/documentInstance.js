const mongoose = require("mongoose");
const { DateTime } = require("luxon")
const Schema = mongoose.Schema;

const DocumentInstanceSchema = new Schema({
    document: { type: Schema.Types.ObjectId, ref: "Document", required: true },
    expire_date_raw: { type: Date, required: true},
    update_date_raw: { type: Date, default: Date.now },
    document_file:{
        data: Buffer,
        contentType: String,
        required: true
    },
});

// Virtual for document's URL
DocumentInstanceSchema.virtual("url").get(function () {
    return `/document_instance/${this._id}`;
});

//Virtual for formatted expire date
DocumentInstanceSchema.virtual("expire_date").get(function(){
    return DateTime.fromJSDate(this.expire_date_raw).toLocaleString(DateTime.DATE_MED);
})

//Virtual for formatted update date
DocumentSchema.virtual("update_date").get(function(){
    return DateTime.fromJSDate(this.update_date_raw).toLocaleString(DateTime.DATE_MED);
})

// Export model
module.exports = mongoose.model("DocumentInstance", DocumentInstanceSchema);
