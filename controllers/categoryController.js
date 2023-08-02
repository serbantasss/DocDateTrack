const Category = require("../models/category");
const Document = require("../models/document");
const Owner = require("../models/owner");

const { body, validationResult } = require("express-validator");
const asyncHandler = require("express-async-handler");

// Display list of all categories.
exports.category_list = asyncHandler(async (req, res, next) => {
    const allCategories = await Category.find().sort({ name: 1 }).exec();
    res.render("categories_list",{
        title: "Category List",
        category_list: allCategories,
        currPage: "category",
    });
});
// Display detail page for a specific document instance.
exports.category_detail = asyncHandler(async (req, res, next) => {
    res.send(`NOT IMPLEMENTED: document detail: ${req.params.id}`);
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
exports.category_create_get = asyncHandler(async (req, res, next) => {
    res.render("category_form",{
        title: "Create new Category",
        relations: Category.schema.path('relation').enumValues,
        currPage: 'categories',
    });
});

// Handle category create on POST.
exports.category_create_post = [
    body("name")
        .trim()
        .isLength({ min: 3 })
        .escape()
        .withMessage("First name must be specified."),
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
                relations: Category.schema.path('relation').enumValues,
                errors: errors.array(),
            });
        } else {
            // Data from form is valid.
            // Check if category with same name already exists.
            const categoryExists = await Category.findOne({ name: req.body.name }).exec();
            if (categoryExists) {
                // Category exists, redirect to categories list.
                res.redirect(categoryExists.url);
            } else {
                await new_category.save();
                // New category saved. Redirect to categories list.
                res.redirect("/categories");
            }
        }
    }),
];

// Handle category deletion on DELETE.
exports.category_delete = asyncHandler(async (req, res, next) => {
    const category = await Category.findById(req.params.id).exec();
    const categoryALTELE = await Category.findById("64b417414caa83ceac5b0be6").exec();
    if (category.equals(categoryALTELE)) {
        console.log("Cannot delete ALETELE category.");
        res.redirect("/");
    } else {
        //Gets all documents related to this category
        // and updates them to ALTELE
        // then deletes the category.
        await Document.updateMany({category: category}, {category: categoryALTELE}).exec();
        console.log("Updated all documents to ALTELE category.");
        await Category.findByIdAndDelete(req.params.id).exec();
        console.log("Category deleted.");
        res.redirect("/categories");
    }
});

// Display category create form on GET.
exports.category_update_get = asyncHandler(async (req, res, next) => {
    const category = await Category.findById(req.params.id).exec();
    if (category === null){
        //No result.
        const err = new Error("Category not found!");
        err.status = 404;
        return next(err);
    }
    res.render("category_form",{
        title: "Create new Category",
        relations: Category.schema.path('relation').enumValues,
        category: category,
        currPage: 'categories',
    });
});

// Handle category create on POST.
exports.category_update_post = [
    body("name")
        .isLength({ min: 1 })
        .withMessage("First name must be specified."),
    asyncHandler(async (req, res, next) => {
        const errors = validationResult(req);

        const updated_category = new Category({
            name: req.body.name,
            relation: req.body.rel,
            _id: req.params.id,
        });
        console.log(req.body);
        if(!errors.isEmpty()){
            res.render("category_form",{
                title: "Create new Category",
                category: updated_category,
                relations: Category.schema.path('relation').enumValues,
                errors: errors.array(),
            });
        } else {
            await Category.findByIdAndUpdate(req.params.id, updated_category);
            // Updated category. Redirect to categories list.
            res.redirect("/categories");
        }
    }),
];