const Category = require("../models/category");
const Document = require("../models/document");

const { body, validationResult } = require("express-validator");
const asyncHandler = require("express-async-handler");

// Display list of all categories.
exports.category_list = asyncHandler(async (req, res, next) => {

    const allTypes = await Category.find().sort({ name: 1 }).exec();

    res.render("category_list",{
        title: "Category List",
        category_list: allTypes,
    })
});

// // Display detail page for a specific category.
// exports.category_detail = asyncHandler(async (req, res, next) => {
//     //res.send(`NOT IMPLEMENTED: category detail: ${req.params.id}`);
//     const [category, docInType] = await Promise.all([
//         DocumentType.findById(req.params.id).exec(),
//         Document.find({category: req.params.id}).populate("owner").exec(),
//     ]);
//     if( category === null){
//         const err = new Error("Type not found");
//         err.status = 405;
//         return next(err);
//     }
//     res.render("category_detail",{
//         title: "categoryDetail",
//         documenttype: category,
//         category_documents: docInType,
//     })
// });

// Display category create form on GET.
exports.category_create_get = (req, res, next) => {
    res.render("category_form",{
        title: "Create new Category",
    });
};

// Handle category create on POST.
exports.category_create_post = [
    body("name")
        .trim()
        .isLength({ min: 1 })
        .escape()
        .withMessage("First name must be specified.")
        .isAlphanumeric()
        .withMessage("First name has non-alphanumeric characters."),
    asyncHandler(async (req, res, next) => {
        const errors = validationResult(req);
        const new_category = new Category({
            name: req.body.name,
            relation: req.body.relation,
        })
        if(!errors.isEmpty()){
            res.render("category_form",{
                title: "Create new Category",
                category: new_category,
                errors: errors,
            });
        } else {
            // Data from form is valid.
            // Check if category with same name already exists.
            const categoryExists = await Category.findOne({ name: req.body.name }).exec();
            if (categoryExists) {
                // Genre exists, redirect to categories list.
                res.redirect("/categories");
            } else {
                await new_category.save();
                // New genre saved. Redirect to categories list.
                res.redirect("/categories");
            }
        }
    }),
];

// Display category delete form on GET.
exports.category_delete_get = asyncHandler(async (req, res, next) => {
    const [category, allDocumentsOfCategory] = await Promise.all([
        Category.findById(req.params.id).exec(),
        Document.find({ category: req.params.id })
    ]);
    if (category === null){
        //no category to delete
        res.redirect("/categories");
    }
    res.render("category_delete",{
        title: "Delete Category",
        category: category,
        owner_documents: allDocumentsOfCategory,
    });
});

// Handle category delete on POST.
exports.category_delete_post = asyncHandler(async (req, res, next) => {
    const [category, allDocumentsOfCategory] = await Promise.all([
        Category.findById(req.params.id).exec(),
        Document.find({ category: req.params.id })
    ]);
    if (allDocumentsOfCategory.length > 0){
        //Documents still in category
        res.render("category_delete",{
            title: "Delete Category",
            category: category,
            owner_documents: allDocumentsOfCategory,
        });
    } else {
        await Category.findByIdAndDelete(req.body.id);
        res.redirect("/categories");
    }
});

// Display category update form on GET.
exports.category_update_get = asyncHandler(async (req, res, next) => {
    const updated_category = await Category.findById(req.params.id).exec();

    if(updated_category === null){
        //No result.
        const err = new Error("Category not found.");
        err.status = 404;
        return next(err);
    }
});

// Handle category update on POST.
exports.category_update_post = [
    body("name")
        .trim()
        .isLength({ min: 1 })
        .escape()
        .withMessage("First name must be specified.")
        .isAlphanumeric()
        .withMessage("First name has non-alphanumeric characters."),

    asyncHandler(async (req, res, next) => {
        const errors = validationResult(req);

        const updated_category = new Category({
            name: req.body.name,
            relation: req.body.relation,
            _id: req.params.id,
        });
        if(!errors.isEmpty()){
            res.render("category_form",{
                title: "Update Gategory",
                category: updated_category,
                errors: errors,
            });
        } else {
            await Category.findOneAndUpdate(req.params.id, updated_category);
            res.redirect("/categories");
        }
    }),
];
