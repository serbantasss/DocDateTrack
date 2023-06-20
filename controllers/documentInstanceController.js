const Document = require("../models/document");
const Category = require("../models/category");
const Owner = require("../models/owner");
const DocumentInstance = require("../models/documentInstance");

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
exports.document_intance_list = asyncHandler(async (req, res, next) => {

    const allDocumentsInstances = await DocumentInstance.find()
        .sort({ expire_date_raw: 1})
        .populate("document")
        .exec();

    res.render("document_instance_list", { title: "Document Instance List", currPage: "document_instances" ,doclist: allDocumentsInstances });
});

// Display detail page for a specific document instance.
exports.document_instance_detail = asyncHandler(async (req, res, next) => {
    res.send(`NOT IMPLEMENTED: document detail: ${req.params.id}`);
});

// Display document instance create form on GET.
exports.document_instance_create_get = asyncHandler(async (req, res, next) => {
    //Get all owners and categories, which we can add to our document
    const allDocuments = await Document.find().exec();

    res.render("document_form",{
        title: "Create Document Instance",
        documents: allDocuments,
    });
});

// Handle document instance create on POST.
exports.document_create_post = [
    //Validate and sanitize form input.
    body("document")
        .trim()
        .isLength({ min: 1 })
        .escape()
        .withMessage("Document must be specified."),
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
        const new_document_instance = new DocumentInstance({
            document: req.body.document,
            expire_date_raw: req.body.expride_date_raw,
            update_date_raw: Date.now,
            document_file: req.body.document_file,
        });
        if (!errors.isEmpty()) {
            // There are validation errors. Render the form again with sanitized values/error messages.
            //Get all owners and categories, which we can add to our document
            const allDocuments = await Document.find().exec();

            res.render("document_form",{
                title: "Create Document Instance",
                documents: allDocuments,
                selected_document: new_document_instance.document._id,
                errors: errors.array(),
                document_instance: new_document_instance
            });
        } else {
            // No validation errors. Create the document.
            await new_document_instance.save();
            res.redirect("/");
        }
    }),
];

// Display document instance delete form on GET.
exports.document_delete_get = asyncHandler(async (req, res, next) => {
    const document_instance = await DocumentInstance.findById(req.params.id).populate("document").exec();
    if (!document_instance) {
        // Document not found.
        res.redirect('/');
        return;
    }
    res.render('document_instance_delete', { title: 'Delete Document Instance', document_instance: document_instance });
});

// Handle document delete on POST.
exports.document_delete_post = asyncHandler(async (req, res, next) => {
    //Delete document. Assumed correct id!
    await DocumentInstance.findByIdAndRemove(req.body.id).exec();
    res.redirect('/');
});


// Display document update form on GET.
exports.document_update_get = asyncHandler(async (req, res, next) => {
    const document_instance = await DocumentInstance.findById(req.params.id).populate("document").exec();
    const allDocuments = await Document.find().exec();
    if (!document_instance) {
        // Document not found.
        const err = new Error("Document instance not found.");
        err.status = 404;
        return next(err);
    }
    res.render('document_instance_form', {
        title: 'Update Document Instance',
        document_list: allDocuments,
        selected_document: document_instance.document._id,
        document_instance: document_instance,
    });
});

// Handle document update on POST.
exports.document_update_post = [
    // Validate and sanitize form input.
    body("document")
        .trim()
        .isLength({ min: 1 })
        .escape()
        .withMessage("Document must be specified."),
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
    asyncHandler(upload.single('document_file'), async (req, res, next) => {
        // Check for validation errors.
        const errors = validationResult(req);
        const new_document_instance = new DocumentInstance({
            document: req.body.document,
            expire_date_raw: req.body.expride_date_raw,
            update_date_raw: Date.now,
            document_file: req.body.document_file,
            _id: req.params.id,
        });
        if (!errors.isEmpty()) {
            // There are validation errors. Render the form again with sanitized values/error messages.
            //Get all owners and categories, which we can add to our document
            const allDocuments = await Document.find().exec();

            res.render("document_form",{
                title: "Create Document Instance",
                documents: allDocuments,
                selected_document: new_document_instance.document._id,
                errors: errors.array(),
                document_instance: new_document_instance
            });
            return;
        } else {
            // No validation errors. Create the document.
            await DocumentInstance.findByIdAndUpdate(req.params.id, new_document_instance);
            res.redirect("/");
        }

        // // No validation errors. Update the document.
        // const document = await Document.findById(req.params.id).exec();
        // if (!document) {
        //     // Document not found.
        //     res.redirect('/');
        //     return;
        // }
        // document.expire_date = req.body.expire_date_raw;
        // if (req.file) {
        //     document.document_file = req.file.path;
        // }
        // await document.save();
        // res.redirect('/');
    }),
];