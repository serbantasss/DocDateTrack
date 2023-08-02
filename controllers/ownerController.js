const Owner = require("../models/owner");
const Document = require("../models/document");
const DocumentInstance = require("../models/documentInstance");

const { body, validationResult } = require('express-validator');
const asyncHandler = require("express-async-handler");

// Display list of all owners.
exports.owners_list = asyncHandler(async (req, res, next) => {
    //res.send("NOT IMPLEMENTED: Owner list");

    const allOwners = await Owner
        .find()
        .sort({ last_name: 'asc' })
        .exec();
    res.render("owners_list",{ title: "Owner List", owners_list: allOwners });
});

// Display detail page for a specific document instance.
exports.owner_detail = asyncHandler(async (req, res, next) => {
    res.send(`NOT IMPLEMENTED: document detail: ${req.params.id}`);
});

// Display owner create form on GET.
exports.owner_create_get = (req, res, next) => {
    res.render("owner_form", { title: "Create Owner" });
};

// Handle owner create on POST.
exports.owner_create_post = [
    //Validate and sanitize form input.
    body("first_name","Invalid first name.")
        .trim()
        .isLength({ min: 3 })
        .isAlphanumeric(),
    body("last_name", "Invalid last name.")
        .trim()
        .isLength({ min: 3 })
        .isAlphanumeric(),
    body("email","Email adress is invalid.")
        .notEmpty()
        .isEmail(),
    body("phone","Phone adress is invalid.")
        .trim()
        .notEmpty()
        .isMobilePhone('ro-RO')
        .withMessage('Romanian phone number only.'),
    //Process request after valid and sanitize.
    asyncHandler(async (req, res, next) => {
        const errors = validationResult(req);

        //Create owner obj with form request data.
        const new_owner = new Owner({
            first_name: req.body.first_name,
            last_name: req.body.last_name,
            phone: req.body.phone,
            email: req.body.email,
        });

        if (!errors.isEmpty()){
            console.log(errors.mapped());
            res.render("owner_form",{
                title: "Create Owner",
                owner: new_owner,
                errors: errors.mapped(),
            });
        } else {
            console.log("lol");
            await new_owner.save();
            res.redirect("/owners");
        }
    }),
];

// Handle owner delete on DELETE.
exports.owner_delete = asyncHandler(async (req, res, next) => {
    const owner = await Owner.findById(req.params.id).exec();
    if (owner === null){
        //No result.
        const err = new Error("Owner not found!");
        console.log("Owner not found!");
        err.status = 404;
        return next(err);
    }

    const documents_of_owner = await Document.find({owner: owner});

    for(const doc of documents_of_owner){
        //Removes all instances of doc
        const instances = await DocumentInstance.find({document: doc}).exec();
        for(const instance of instances){
            //await DocumentInstance.findByIdAndDelete(instance._id).exec();
            console.log("Removed instance with id " + instance._id);
        }
        console.log("Removed all instances of" + doc._id);
    }
    //Now removes all documents of owner
    //await Document.deleteMany({owner: owner}).exec();
    console.log("Deleted all documents deleted of owner:" + req.params.id);
    //Now removes owner
    //await Owner.findByIdAndDelete(req.params.id).exec();
    console.log("Deleted owner:" + req.params.id);

    res.redirect("/owners");
});

// Display owner update form on GET.
exports.owner_update_get = asyncHandler(async (req, res, next) => {
    //res.send("NOT IMPLEMENTED: owner update GET");
    const owner = await Owner.findById(req.params.id).exec();
    if (owner === null){
        //No result.
        const err = new Error("Owner not found!");
        err.status = 404;
        return next(err);
    }
    res.render("owner_form", {
        title: "Update Owner",
        owner: owner,
    });
});

// Handle owner update on POST.
exports.owner_update_post = [
    //Validate and sanitize form input.
    body("first_name","Invalid first name.")
        .trim()
        .isLength({ min: 3 })
        .isAlphanumeric(),
    body("last_name", "Invalid last name.")
        .trim()
        .isLength({ min: 3 })
        .isAlphanumeric(),
    body("email","Email adress is invalid.")
        .notEmpty()
        .isEmail(),
    body("phone","Phone adress is invalid.")
        .trim()
        .notEmpty()
        .isMobilePhone('ro-RO')
        .withMessage('Romanian phone number only.'),
    //Process request after valid and sanitize.
    asyncHandler(async (req, res, next) => {
        const errors = validationResult(req);

        const updated_owner = new Owner({
            first_name: req.body.first_name,
            last_name: req.body.last_name,
            phone: req.body.phone,
            email: req.body.email,
            _id: req.params.id,
        });

        if(!errors.isEmpty()){
            res.render("owner_form",{
                title: "Update Owner",
                owner: updated_owner,
                errors: errors.array(),
            });
            return;
        } else {
            await Owner.findByIdAndUpdate(req.params.id, updated_owner);
            res.redirect("/owners");
        }
    },
)];
