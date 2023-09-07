const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const Schema = mongoose.Schema;

const OwnerSchema = new Schema({
    first_name: { type: String, required: true, maxLength: 100 },
    last_name: { type: String, required: true, maxLength: 100 },
    phone: { type: String },
    email: { type: String, required: true },
    password: { type: String, required: true}
});

OwnerSchema.pre('save', async function(next) {
    try {
        // check method of registration
        const user = this;
        if (!user.isModified('password')) next();
        // generate salt
        const salt = await bcrypt.genSalt(10);
        // hash the password
        const hashedPassword = await bcrypt.hash(this.password, salt);
        // replace plain text password with hashed password
        this.password = hashedPassword;
        next();
    } catch (error) {
        return next(error);
    }
});

// Virtual for author's full name
OwnerSchema.virtual("name").get(function () {
    return `${this.last_name} ${this.first_name}`;
});

// Virtual for author's full name
OwnerSchema.virtual("sid").get(function () {
    return `${this.last_name}${this.first_name}`;
});

// Virtual for author's URL
OwnerSchema.virtual("url").get(function () {
    return `/owner/${this._id}`;
});

// Export model
module.exports = mongoose.model("Owner", OwnerSchema);
