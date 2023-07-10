const Document = require("../models/document");
const DocumentInstance = require("../models/documentInstance");

const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
    service: "gmail.com",
    auth: {
        user: "serbantassss@gmail.com" ,
        pass: "ppllrbmepongfdxi",
    },
});

const { DateTime } = require("luxon");

// Function to send emails for expired documents
async function sendEmailsForExpiredDocuments() {
    try {
        // Fetch all documents with status "Expired"
        const expiredDocuments = await Document.find({ status: "Expired" })
            .populate("owner")
            .populate("category")
            .exec();

        // Iterate through each expired document and send an email
        for (const document of expiredDocuments) {
            // Send email logic goes here

            const last_instance = await DocumentInstance.findOne({
                document: document._id,
            }).sort({expire_date_raw: 1});

            single_email(
                document.owner.email,
                document.owner.name,
                document.category.name,
                last_instance.expires_date_raw
            );
        }

        console.log("Emails sent for expired documents.");
    } catch (error) {
        console.error("Error sending emails for expired documents:", error);
    }
}

function single_email(owner_email, owner_name, document_name, document_expiry_date){
    try {
        const mailOptions = {
            from: "serbantassss@gmail.com",
            to: owner_email,
            subject: "Expired Document" + document_name,
            html: `<p>Hello,</p>
                    <p>The following document will expire soon: ${document_name}</p>
                    <p>The document will expire on ${DateTime.fromJSDate(
                document_expiry_date
            ).toLocaleString(DateTime.DATE_MED)}</p>`,
        };
        transporter.sendMail(mailOptions);
        console.log(`Sending email for expired document:  ${document_name} of ${owner_name}`);
    } catch (error) {
        console.error("Error sending emails for expired documents:", error);
    }
}

module.exports = {
    sendEmailsForExpiredDocuments,
    single_email,
};