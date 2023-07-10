const Document = require("../models/document");
const DocumentInstance = require("../models/documentInstance");
const { DateTime } = require("luxon");

// Define the function that performs the checks
async function dbCheck() {
    try {
        // Fetch all documents from the database
        const documents = await Document.find({});

        // Iterate through each document
        for (const document of documents) {
            // Fetch the last document instance for the current document

            const last_instance = await DocumentInstance.findOne({
                document: document._id,
            }).sort({expire_date_raw: 1});
            const expireDate = DateTime.fromJSDate(last_instance.expire_date_raw);

            const currentDate = DateTime.now();
            const daysDifference = expireDate.diff(currentDate, "days").days;

            // Update the status to "Update Soon" if the expiry date is close to the current date
            // and to "Expired" if the doc is expired!
            if (daysDifference < 0) {
                document.status = "Expired";
                await document.save();
            }else {
                if (daysDifference <= 7) {
                    document.status = "Update Soon";
                    await document.save();
                } else {
                    document.status = "Updated";
                    await document.save();
                }
            }
        }

        console.log("Database checks completed.");
    } catch (error) {
        console.error("Error performing database checks:", error);
    }
}

module.exports = dbCheck;