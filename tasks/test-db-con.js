const mongoose = require("mongoose");
const Owner = require("../models/owner");
const Category = require("../models/category");
const Document = require("../models/document");

const mongoDB = process.env.MONGODB_URI;

if (!mongoDB) {
    throw new Error("MONGODB_URI must be set before running this task");
}

async function run() {
    try {
        await mongoose.connect(mongoDB);
        console.log("Connected to MongoDB.");

        const allOwners = await Owner.find().exec();
        const allCategories = await Category.find().exec();

        for (const owner of allOwners) {
            for (const category of allCategories) {
                const newDocument = new Document({
                    owner,
                    category,
                    status: "Updated",
                });
                await newDocument.save();
                console.log("Added new document!");
            }
        }
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
