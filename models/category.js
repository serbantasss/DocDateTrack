const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const CategorySchema = new Schema({
    name: { type: String, require:true },
    relation: {
        type: String,
        enum: ["Personal", "Munca", "Altele"],
    },
});

CategorySchema.virtual("url").get(function(){
    return `/category/${this._id}`
});

module.exports = mongoose.model("Category", CategorySchema);
