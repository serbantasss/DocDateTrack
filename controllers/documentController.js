const Document = require("../models/document");
const DocumentType = require("../models/category");
const Owner = require("../models/owner");

const asyncHandler = require("express-async-handler");

exports.index = asyncHandler(async (req, res, next) => {
    //res.send("NOT IMPLEMENTED: Site Home Page");
    const [
        numDocuments,
        numOwners,
        numDocTypes
    ] = await Promise.all([
        Document.countDocuments({}).exec(),
        Owner.countDocuments({}).exec(),
        DocumentType.countDocuments({}).exec(),
    ])

    res.render("index",{
        title: "Document Tracking Home",
        document_count: numDocuments,
        owner_count: numOwners,
        doctype_count: numDocTypes,
    })
});

// Display list of all documents.
exports.document_list = asyncHandler(async (req, res, next) => {
    //res.send("NOT IMPLEMENTED: document list");
    const allDocuments = await Document.find({},)
        .sort({ expire_date: 1})
        .populate("owner")
        .exec();

    res.render("document_list", { title: "Document List", document_list: allDocuments });
});

// Display detail page for a specific document.
exports.document_detail = asyncHandler(async (req, res, next) => {
    res.send(`NOT IMPLEMENTED: document detail: ${req.params.id}`);
});

// Display document create form on GET.
exports.document_create_get = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: document create GET");
});

// Handle document create on POST.
exports.document_create_post = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: document create POST");
});

// Display document delete form on GET.
exports.document_delete_get = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: document delete GET");
});

// Handle document delete on POST.
exports.document_delete_post = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: document delete POST");
});

// Display document update form on GET.
exports.document_update_get = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: document update GET");
});

// Handle document update on POST.
exports.document_update_post = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: document update POST");
});
