const Document = require("../models/document");
const Category = require("../models/category");
const Owner = require("../models/owner");

const asyncHandler = require("express-async-handler");
const { body, validationResult } = require("express-validator");

const multer = require('multer');
const path = require('path');

// Set up multer middleware to handle file uploads.
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// Display list of all documents.
exports.document_list = asyncHandler(async (req, res, next) => {

    const allDocuments = await Document.find({},)
        .sort({ expire_date: 1})
        .populate("owner")
        .exec();

    res.render("document_list", { title: "Document List", document_list: allDocuments });
});

// // Display detail page for a specific document.
// exports.document_detail = asyncHandler(async (req, res, next) => {
//     res.send(`NOT IMPLEMENTED: document detail: ${req.params.id}`);
// });

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
    body("status")
        .escape(),
    body("expire_date_raw", "Invalid expiry date")
        .optional({values: "falsy"})
        .isISO8601()
        .toDate(),
    body("document_file")
        .custom((value, { req }) => {
            if (!req.file) {
                throw new Error('Document file is required.');
            }
            return true;
        }),
    asyncHandler(upload.single("document_file"), async (req, res, next) => {
        // Check for validation errors.
        const errors = validationResult(req);
        const new_document = new Document({
            owner: req.body.owner,
            category: req.body.category,
            status: req.body.status,
            expire_date_raw: req.body.expride_date_raw,
            update_date_raw: Date.now,
            document_file: req.body.document_file,
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
                expire_date: req.body.expire_date_raw,
                document_file: req.file.path,
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
    const document = await Document.findById(req.params.id).exec();
    if (!document) {
        // Document not found.
        res.redirect('/');
        return;
    }
    res.render('document_form', {
        title: 'Update Document',
        document: document,
    });
});

// Handle document update on POST.
// Handle document update on POST.
exports.document_update_post = [
    // Validate and sanitize form input.
    body('expire_date_raw', 'Invalid expiry date')
        .optional({ nullable: true })
        .isISO8601()
        .toDate(),
    asyncHandler(upload.single('document_file'), async (req, res, next) => {
        // Check for validation errors.
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            // There are validation errors. Render the form again with sanitized values/error messages.
            const [allOwners, allCategories] = await Promise.all([
                Owner.find().exec(),
                Category.find().exec(),
            ]);
            res.render('document_form', {
                title: 'Update Document',
                owners: allOwners,
                categories: allCategories,
                document: req.body,
                errors: errors.array(),
            });
            return;
        }

        // No validation errors. Update the document.
        const document = await Document.findById(req.params.id).exec();
        if (!document) {
            // Document not found.
            res.redirect('/');
            return;
        }
        document.expire_date = req.body.expire_date_raw;
        if (req.file) {
            document.document_file = req.file.path;
        }
        await document.save();
        res.redirect('/');
    }),
];