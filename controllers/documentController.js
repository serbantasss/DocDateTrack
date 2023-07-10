const Document = require("../models/document");
const Category = require("../models/category");
const Owner = require("../models/owner");
const DocumentInstace = require("../models/documentInstance");

const asyncHandler = require("express-async-handler");
const { body, validationResult } = require("express-validator");
const {DateTime} = require("luxon");

// Display list of all documents.
exports.document_list = asyncHandler(async (req, res, next) => {

    const allDocuments = await Document.find().populate("owner").populate("category").exec();
    const allOwners = await Owner.find().exec();
    const allCategories = await Category.find({relation: req.params.relation}).exec();

    res.render("document_list", {
        title: "Document List" + `${req.params.relation}`,
        currPage: "documents" ,
        document_list: allDocuments,
        owners_list: allOwners,
        categories_list: allCategories,
    });
});

// Display detail page for a specific document.
exports.document_detail = asyncHandler(async (req, res, next) => {

    const document = await Document.findById(req.params.id)
        .populate("owner")
        .populate("category")
        .exec();

    if (!document) {
        const error = new Error("Document not found");
        error.status = 404;
        throw error;
    }

    const owner = document.owner;
    const category = document.category;

    const instances = await DocumentInstace.find({ owner, category }).exec();
    const currentDate = DateTime.local();
    res.render("document_detail", {
        title: "Document Detail",
        document,
        owner,
        category,
        instances,
        time_ago: function(instance){
            return DateTime.fromJSDate(instance.expire_date_raw).toRelativeCalendar();
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
exports.document_create_post = [
    //Validate and sanitize form input.
    body("owner")
        .trim()
        .isLength({ min: 1 })
        .escape()
        .withMessage("Owner name must be specified."),
    body("category")
        .trim()
        .isLength({ min: 1 })
        .escape()
        .withMessage("Category must be specified."),
    asyncHandler(async (req, res, next) => {
        // Check for validation errors.
        const errors = validationResult(req);
        const new_document = new Document({
            owner: req.body.owner,
            category: req.body.category,
        });
        if (!errors.isEmpty()) {
            // There are validation errors. Render the form again with sanitized values/error messages.
            const [allOwners, allCategories] = await Promise.all([
                Owner.find().exec(),
                Category.find().exec(),
            ]);
            res.render('document_form', {
                title: 'Create Document',
                owners: allOwners,
                categories: allCategories,
                document: new_document,
                errors: errors.array(),
            });
            return;
        } else {
            // No validation errors. Create the document.
            const document = new Document({
                owner: req.body.owner,
                category: req.body.category,
                status: req.body.status,
            });
            await document.save();
            res.redirect("/");
        }
    }),
];

// Display document delete form on GET.
exports.document_delete_get = asyncHandler(async (req, res, next) => {
    const document = await Document.findById(req.params.id).exec();
    if (!document) {
        // Document not found.
        res.redirect('/');
        return;
    }
    res.render('document_delete', { title: 'Delete Document', document: document });
});

// Handle document delete on POST.
exports.document_delete_post = asyncHandler(async (req, res, next) => {
    //Delete document. Assumed correct id!
    await Document.findByIdAndRemove(req.body.id).exec();
    res.redirect('/');
});


// Display document update form on GET.
exports.document_update_get = asyncHandler(async (req, res, next) => {
    res.send(`NOT IMPLEMENTED: document detail: ${req.params.id}`);
});

// Handle document update on POST.
// Handle document update on POST.
exports.document_update_post = [
    // Validate and sanitize form input.
    body('expire_date_raw', 'Invalid expiry date')
        .optional({ nullable: true })
        .isISO8601()
        .toDate(),
    asyncHandler( async (req, res, next) => {
        res.send(`NOT IMPLEMENTED: document detail: ${req.params.id}`);
    }),
];