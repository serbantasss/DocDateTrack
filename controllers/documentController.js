const Document = require("../models/document");
const Category = require("../models/category");
const Owner = require("../models/owner");
const DocumentInstance = require("../models/documentInstance");

const asyncHandler = require("express-async-handler");
const { body, validationResult } = require("express-validator");
const {DateTime} = require("luxon");
const {stringify} = require("nodemon/lib/utils");

// Display list of all documents.
exports.document_list = asyncHandler(async (req, res, next) => {

    const relation = req.params.relation;

    const allDocuments = await Document.find().exec();
    allDocuments.forEach((doc) => {
        doc.owner = doc.owner.toString();
        doc.category = doc.category.toString();
    });
    const allOwners = await Owner.find().exec();
    const allCategories = relation ? await Category.find({relation: relation}).exec() : await Category.find().exec();

    res.render("document_list", {
        title: "Document List" + (relation || ""),
        currPage: "documents" ,
        owners_list: allOwners,
        categories_list: allCategories,
        current_doc_id: function(owner_id, category_id){
            for(doc of allDocuments){
                if(String(doc.owner) === String(owner_id) && String(doc.category) === String(category_id)){
                    return doc._id;
                }
            }
            return;
        },
    });
});

// Display detail page for a specific document.
exports.document_detail = asyncHandler(async (req, res, next) => {

    const document = await Document.findById(req.params.id)
        .exec();

    if (!document) {
        const error = new Error("Document not found");
        error.status = 404;
        throw error;
    }

    const owner = document.ownerData;
    const category = document.categoryData;

    const instances = await DocumentInstance.find({document: document}).exec();

    res.render("document_detail", {
        title: "Document Detail",
        document,
        owner,
        category,
        instances,
        daysDifference: function(raw_date){
            return parseInt(DateTime.now().diff(DateTime.fromJSDate(raw_date), "days").days);
        },
        time_ago: function(raw_date){
            return DateTime.fromJSDate(raw_date).toRelativeCalendar();
        },
    });
});

// Display document create form on GET.
exports.document_create_get = asyncHandler(async (req, res, next) => {
    //Get all owners and categories, which we can add to our document
    const [allOwners, allCategories] = await Promise.all([
        Owner.find().exec(),
        Category.find().exec(),
    ]);

    res.render("document_form",{
        title: "Create Document",
        owners: allOwners,
        categories: allCategories,
    });
});

// Handle document create on POST.
exports.document_create_post = asyncHandler(async (req, res, next) => {
    // Check if a document with the same owner and category already exists.
    const existingDocument = await Document.findOne({
        owner: req.body.owner,
        category: req.body.category,
    }).exec();

    if (existingDocument)
        res.redirect(existingDocument.url);
    else {
        // No document with the same owner and category exists. Create the new document.
        const new_document = new Document({
            owner: req.body.owner,
            category: req.body.category,
        });
        await new_document.save();
        res.redirect(new_document.url);
    }
});

//Handle document deletion with DELETE.
exports.document_delete = asyncHandler( async (req, res, next) => {
    const document = await Document.findById(req.params.id).exec();
    if (!document) {
        res.redirect('..');
        // Document not found. Redirect back
    }
    const instances = await DocumentInstance.find({document: document},'id').exec();
    for(const instance of instances) {
        await DocumentInstance.findById(instance._id).exec();
        console.log("Removed all instances of" + instance._id);
    }
    //await Document.findByIdAndRemove(req.params.id).exec();
    console.log("Removed document:" + req.params.id);
    res.redirect('/documents');
});