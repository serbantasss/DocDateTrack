const Owner = require("../models/owner");
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

// Display detail page for a specific owner.
exports.owner_detail = asyncHandler(async (req, res, next) => {
    res.send(`NOT IMPLEMENTED: owner detail: ${req.params.id}`);
});

// Display owner create form on GET.
exports.owner_create_get = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: owner create GET");
});

// Handle owner create on POST.
exports.owner_create_post = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: owner create POST");
});

// Display owner delete form on GET.
exports.owner_delete_get = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: owner delete GET");
});

// Handle owner delete on POST.
exports.owner_delete_post = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: owner delete POST");
});

// Display owner update form on GET.
exports.owner_update_get = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: owner update GET");
});

// Handle owner update on POST.
exports.owner_update_post = asyncHandler(async (req, res, next) => {
    res.send("NOT IMPLEMENTED: owner update POST");
});
