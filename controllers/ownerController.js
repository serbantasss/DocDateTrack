const Owner = require("../models/owner");
const Document = require("../models/document")
const { body, validationResult } = require('express-validator');
const asyncHandler = require("express-async-handler");

// Display list of all owners.
exports.owner_list = asyncHandler(async (req, res, next) => {
    //res.send("NOT IMPLEMENTED: Owner list");

    const allOwners = await Owner
        .find()
        .sort({ last_name: 'asc' })
        .exec();
    res.render("owner_list",{ title: "Owner List", owner_list: allOwners });
});

// Display owner create form on GET.
exports.owner_create_get = (req, res, next) => {
    res.render("owner_form", { title: "Create Owner" });
};

// Handle owner create on POST.
exports.owner_create_post = [
    //Validate and sanitize form input.
    body("first_name")
        .trim()
        .isLength({ min: 1 })
        .escape()
        .withMessage("First name must be specified.")
        .isAlphanumeric()
        .withMessage("First name has non-alphanumeric characters."),
    body("family_name")
        .trim()
        .isLength({ min: 1 })
        .escape()
        .withMessage("Family name must be specified.")
        .isAlphanumeric()
        .withMessage("Family name has non-alphanumeric characters."),
    body("email")
        .notEmpty()
        .escape()
        .isEmail()
        .withMessage('Email adress is invalid.'),
    body("phone")
        .trim()
        .notEmpty()
        .escape()
        .isMobilePhone()
        .withMessage('Phone number is invalid.'),

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
            res.render("owner_form",{
                title: "Create Owner",
                owner: new_owner,
                errors: errors.array(),
            });
            return;
        } else{
            await new_owner.save();
            res.redirect("/owners");
        }
    })];

// Display owner delete form on GET.
exports.owner_delete_get = asyncHandler(async (req, res, next) => {
    //res.send("NOT IMPLEMENTED: owner delete GET");
    const [owner, allDocumentsOfOwner] = await Promise.all([
        Owner.findby(req.params.id).exec(),
        Document.find({ owner: req.params.id })
    ]);
    if (owner === null){
        //no owner to delete
        res.redirect("/owners");
    }
    res.render("owner_delete",{
        title: "Delete Owner",
        owner: owner,
        owner_documents: allDocumentsOfOwner,
    });
});

// Handle owner delete on POST.
exports.owner_delete_post = asyncHandler(async (req, res, next) => {
    //res.send("NOT IMPLEMENTED: owner delete POST");
    const [owner, allDocumentsOfOwner] = await Promise.all([
        Owner.findby(req.params.id).exec(),
        Document.find({ owner: req.params.id })
    ]);
    if (allDocumentsOfOwner.length > 0){
        //Owner still has documents.
        res.render("owner_delete",{
            title: "Delete Owner",
            owner: owner,
            owner_documents: allDocumentsOfOwner,
        });
    } else {
        //Owner has no documents in use.
        await Owner.findByIdAndRemove(req.body.authorid);
        res.redirect("/owners");
    }
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
    body("first_name")
        .trim()
        .isLength({ min: 1 })
        .escape()
        .withMessage("First name must be specified.")
        .isAlphanumeric()
        .withMessage("First name has non-alphanumeric characters."),
    body("family_name")
        .trim()
        .isLength({ min: 1 })
        .escape()
        .withMessage("Family name must be specified.")
        .isAlphanumeric()
        .withMessage("Family name has non-alphanumeric characters."),
    body("email")
        .notEmpty()
        .escape()
        .isEmail()
        .withMessage('Email adress is invalid.'),
    body("phone")
        .trim()
        .notEmpty()
        .escape()
        .isMobilePhone()
        .withMessage('Phone number is invalid.'),

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
})];
