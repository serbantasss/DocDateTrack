const DocumentType = require("../models/category");
const Document = require("../models/document");
const asyncHandler = require("express-async-handler");

// Display list of all doctype.
exports.doctype_list = asyncHandler(async (req, res, next) => {
    //res.send("NOT IMPLEMENTED: doctype list");
    const allTypes = await DocumentType.find().sort({ name: 1 }).exec();
    res.render("doctype_list",{
        title: "Document Type List",
        doctype_list: allTypes,
    })
});

// Display detail page for a specific doctype.
exports.doctype_detail = asyncHandler(async (req, res, next) => {
    //res.send(`NOT IMPLEMENTED: doctype detail: ${req.params.id}`);
    const [doctype, docInType] = await Promise.all([
        DocumentType.findById(req.params.id).exec(),
        Document.find({doctype: req.params.id}).populate("owner").exec(),
    ]);
    if( doctype === null){
        const err = new Error("Type not found");
        err.status = 405;
        return next(err);
    }
    res.render("doctype_detail",{
        title: "DocTypeDetail",
        documenttype: doctype,
        doctype_documents: docInType,
    })
});

// Display doctype create form on GET.
exports.doctype_create_get = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: doctype create GET");
});

// Handle doctype create on POST.
exports.doctype_create_post = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: doctype create POST");
});

// Display doctype delete form on GET.
exports.doctype_delete_get = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: doctype delete GET");
});

// Handle doctype delete on POST.
exports.doctype_delete_post = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: doctype delete POST");
});

// Display doctype update form on GET.
exports.doctype_update_get = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: doctype update GET");
});

// Handle doctype update on POST.
exports.doctype_update_post = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: doctype update POST");
});
