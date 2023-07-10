const Document = require("./models/document");
const DocumentInstance = require("./models/documentInstance");
const { DateTime } = require("luxon");

// Define the function that performs the checks
async function dbCheck() {
    try {
        // Fetch all documents from the database
        const documents = await Document.find({});

        // Iterate through each document
        for (const document of documents) {
            // Fetch the document instances for the current document
            const documentInstances = await DocumentInstance.find({
                document: document._id,
            }).sort({expire_date_raw: 1});

            const firstDoucmentInstance = documentInstaces[0];
            const expireDate = DateTime.fromJSDate(firstDoucmentInstance.expire_date_raw);

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

// Function to send emails for expired documents
async function sendEmailsForExpiredDocuments() {
    try {
        // Fetch all documents with status "Expired"
        const expiredDocuments = await Document.find({ status: "Expired" });

        // Iterate through each expired document and send an email
        for (const document of expiredDocuments) {
            // Send email logic goes here
            console.log(`Sending email for expired document: ${document._id}`);
        }

        console.log("Emails sent for expired documents.");
    } catch (error) {
        console.error("Error sending emails for expired documents:", error);
    }
}


// Export the function to be used in other files if needed
module.exports = dbCheck;