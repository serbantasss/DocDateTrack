const Owner = require("../models/owner");
const Category = require("../models/category");
const Document = require("../models/document");

// Set up mongoose connection
const mongoose = require("mongoose");
mongoose.set("strictQuery", false);

const dev_db_url =
    "mongodb+srv://docAdmin:docPassword@cluster0.zaexh0d.mongodb.net/doctrackbase1?retryWrites=true&w=majority";
const mongoDB = process.env.MONGODB_URI || dev_db_url;


async function run() {
    try {
        // // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        // // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        await mongoose.connect(mongoDB);

        console.log("Pinged your deployment. You successfully connected to MongoDB!");

        const allOwners = await Owner.find().exec();
        const allCategories = await Category.find().exec();

        for(const owner of allOwners){
            for(const category of allCategories){
                const new_document = new Document({
                    owner: owner,
                    category: category,
                    status: "Updated",
                });
                await new_document.save();
                console.log("Added new document!");
            }
        }
    } finally {
        // Ensures that the client will close when you finish/error
        await mongoose.close();
    }
}
run().catch(console.dir);
