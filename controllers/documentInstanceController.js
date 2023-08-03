const Document = require("../models/document");
const Category = require("../models/category");
const Owner = require("../models/owner");
const DocumentInstance = require("../models/documentInstance");

const asyncHandler = require("express-async-handler");
const { body, validationResult } = require("express-validator");

const multer = require('multer');
const fs = require("fs");
const {DateTime} = require("luxon");

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads');
    },
    filename: async (req, file, cb) => {
        const ext = file.mimetype.split("/")[1];

        const selected_owner = await Owner.findById(req.body.owner).exec();
        const selected_category = await Category.findById(req.body.category).exec();

        const name = selected_category.name.split(' ').join('_')+'-'+selected_owner.name.split(' ').join('_');

        cb(null, `${name}-${Date.now()}.${ext}`);
    }
});

// Multer Filter
const multerFilter = (req, file, cb) => {
    if (file.mimetype.split("/")[1] === "pdf") {
        cb(null, true);
    } else {
        cb(new Error("Not a PDF File!!"), false);
    }
};

const upload = multer({
    storage: storage,
});

// Display list of all documents.
exports.document_instance_list = asyncHandler(async (req, res, next) => {
    const allDocumentsInstances = await DocumentInstance.find()
        .sort({ expire_date_raw: 1})
        .populate("document")
        .exec();
    res.render("instance_list", {
        title: "Document Instance List",
        currPage: "document_instances" ,
        instances: allDocumentsInstances,
        daysDifference: function(raw_date){
            return parseInt(DateTime.now().diff(DateTime.fromJSDate(raw_date), "days").days);
        },
        time_ago: function(raw_date){
            return DateTime.fromJSDate(raw_date).toRelativeCalendar();
        },
    });
});

// Display detail page for a specific document instance.
exports.document_instance_detail = asyncHandler(async (req, res, next) => {
    res.send(`NOT IMPLEMENTED: document detail: ${req.params.id}`);
});

// Display document instance create form on GET.
exports.document_instance_create_get = asyncHandler(async (req, res, next) => {
    //Get all owners and categories, which we can add to our document
    const allCategories = await Category.find().exec();
    const allOwners = await Owner.find().exec();

    res.render("instance_form",{
        title: "Create Document Instance",
        categories_list: allCategories,
        owners_list: allOwners,
    });
});


// Handle document instance create on POST.
exports.document_instance_create_post =[
    // Validate and sanitize form input.
    upload.single("document_file"),
    asyncHandler( async (req, res, next) => {

        const selected_owner = await Owner.findById(req.body.owner).exec();
        const selected_category = await Category.findById(req.body.category).exec();

        const selected_document = await Document.findOne({ owner: selected_owner, category: selected_category}).exec();

        if (!selected_document) {
            // Create new document with the selected category and the selected owner.
            await new Document({
                owner: req.body.owner,
                category: req.body.category,
            }).save();
        }

        const new_document_instance = new DocumentInstance({
            document: selected_document,
            expire_date_raw: req.body.expire_date_raw,
            update_date_raw: req.body.update_date_raw || Date.now(),
            document_file: req.file.filename,
        });

        await new_document_instance.save();
        res.redirect(selected_document.url);
    }),
];

//Handle document instance deletion on DELTETE request.
exports.document_instance_delete = asyncHandler(async (req, res, next) => {
    const documentInstance = await DocumentInstance.findById(req.params.id).exec();
    // Remove the file from the 'uploads' folder
    fs.unlink(`./uploads/${documentInstance.document_file}`, (err) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Error deleting file");
        }
        console.log("File deleted successfully");
    });

    await DocumentInstance.findByIdAndRemove(req.params.id).exec();
    console.log("Removed all instances of" + req.params._id);
    res.redirect('/');
});

//Handle document instance download on GET request.
exports.document_instance_download_get =  (req, res, next) => {
    res.download(`./uploads/${req.params.id}`);
};


