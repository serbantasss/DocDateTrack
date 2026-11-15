const mongoose = require("mongoose");
const Owner = require("../models/owner");
const Category = require("../models/category");
const Document = require("../models/document");

const mongoDB = process.env.MONGODB_URI;
const demoPassword = process.env.DEMO_USER_PASSWORD || "LocalDemoOnly123!";
const demoOwners = [
    {
        username: "demo",
        first_name: "Alex",
        last_name: "Demo",
        email: "alex.demo@example.test",
        phone: "555-0101",
    },
    {
        username: "demo.jamie",
        first_name: "Jamie",
        last_name: "Sample",
        email: "jamie.sample@example.test",
        phone: "555-0102",
    },
    {
        username: "demo.taylor",
        first_name: "Taylor",
        last_name: "Example",
        email: "taylor.example@example.test",
        phone: "555-0103",
    },
];
const demoCategories = [
    { name: "Employment Contract", relation: "DP", status: "Updated" },
    { name: "Identity Certificate", relation: "DF", status: "Update Soon" },
    { name: "Medical Certificate", relation: "DPF", status: "Expired" },
];

async function seedDemoData() {
    if (!mongoDB || !demoPassword) {
        throw new Error("MONGODB_URI and DEMO_USER_PASSWORD must be set");
    }

    await mongoose.connect(mongoDB);

    if (mongoose.connection.name !== "docdatetrack_dev") {
        throw new Error("Refusing to seed a database other than docdatetrack_dev");
    }

    const owners = [];
    for (const ownerData of demoOwners) {
        let owner = await Owner.findOne({ username: ownerData.username });
        if (!owner) {
            owner = await Owner.register(new Owner(ownerData), demoPassword);
        }
        owners.push(owner);
    }

    const categories = [];
    for (const categoryData of demoCategories) {
        const category = await Category.findOneAndUpdate(
            { name: categoryData.name },
            { $set: { relation: categoryData.relation } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        categories.push({ category, status: categoryData.status });
    }

    for (const owner of owners) {
        for (const { category, status } of categories) {
            await Document.findOneAndUpdate(
                { owner: owner._id, category: category._id },
                { $set: { status } },
                { new: true, upsert: true, setDefaultsOnInsert: true }
            );
        }
    }

    console.log(`Seeded demo data in ${mongoose.connection.name}: ${owners.length} accounts, ${categories.length} categories, ${owners.length * categories.length} documents.`);
}

seedDemoData()
    .catch((error) => {
        console.error("Unable to seed demo data:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
