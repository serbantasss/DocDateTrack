const express = require('express');
const router = express.Router();

/* GET home page. */
const owner_controller = require("../controllers/ownerController");
const document_controller = require("../controllers/documentController");
const category_controller = require("../controllers/categoryController");
const document_instance_controller = require("../controllers/documentInstanceController");


const asyncHandler = require("express-async-handler");
const Document = require("../models/document");
const Owner = require("../models/owner");
const Category = require("../models/category");
const DocumentInstance = require("../models/documentInstance");

//Render Home Page.
router.get('/', function(req, res, next) {
  res.render('index', {title: "Home", currPage: "home"});
});
/*exports.index = asyncHandler(async (req, res, next) => {
  //res.send("NOT IMPLEMENTED: Site Home Page");
  const [
    numDocuments,
    numOwners,
    numDocTypes
  ] = await Promise.all([
    Document.countDocuments({}).exec(),
    Owner.countDocuments({}).exec(),
    DocumentType.countDocuments({}).exec(),
  ])

  res.render("index",{
    title: "Document Tracking Home",
    document_count: numDocuments,
    owner_count: numOwners,
    doctype_count: numDocTypes,
  })
});*/

/**
 DOCUMENT ROUTES.
 */

//GET request to create document.
router.get("/document/create", document_controller.document_create_get);

//POST request to create document.
router.post("/document/create", document_controller.document_create_post);

//GET request to remove document.
router.get("/document/:id/delete", document_controller.document_delete_get);

//POST request to remove document.
router.post("/document/:id/delete", document_controller.document_delete_post);

//GET request to update document.
router.get("/document/:id/update", document_controller.document_update_get);

//POST request to update document.
router.post("/document/:id/update", document_controller.document_update_post);

//GET request for one document info.
router.get("/document/:id", document_controller.document_detail);

//GET request for list of documents.
router.get("/documents", document_controller.document_list);

/**
  OWNER ROUTES.
 */

//GET request to create owner.
router.get("/owner/create", owner_controller.owner_create_get);

//POST request to create owner.
router.post("/owner/create", owner_controller.owner_create_post);

//GET request to remove owner.
router.get("/owner/:id/delete", owner_controller.owner_delete_get);

//POST request to remove owner.
router.post("/owner/:id/delete", owner_controller.owner_delete_post);

//GET request to update owner.
router.get("/owner/:id/update", owner_controller.owner_update_get);

//POST request to update owner.
router.post("/owner/:id/update", owner_controller.owner_update_post);

//GET request for one document info.
router.get("/owner/:id", owner_controller.owner_detail);

//GET request for list of owners.
router.get("/owners", owner_controller.owners_list);

/**
 CATEGORY ROUTES.
 */

//GET request to create category.
router.get("/category/create", category_controller.category_create_get);

//POST request to create category.
router.post("/category/create", category_controller.category_create_post);

//GET request to remove category.
router.get("/category/:id/delete", category_controller.category_delete_get);

//POST request to remove category.
router.post("/category/:id/delete", category_controller.category_delete_post);

//GET request to update category.
router.get("/category/:id/update", category_controller.category_update_get);

//POST request to update category.
router.post("/category/:id/update", category_controller.category_update_post);

//GET request for one document info.
router.get("/category/:id", category_controller.category_detail);

//GET request for list of categories.
router.get("/categories", category_controller.category_list);

/**
 DOCUMENT INSTANCE ROUTES.
 */



//GET request to create document instance.
router.get("/document_instance/create", document_instance_controller.document_instance_create_get);

//POST request to create document instance.
router.post("/document_instance/create", document_instance_controller.document_instance_create_post);

//GET request for one document info.
router.get("/document_instance/:id", document_instance_controller.document_instance_detail);

//GET request for list of documents.
router.get("/document_instances", document_instance_controller.document_instance_list);


/**
 * EXTRA ROUTES
 */
//main listing routes
router.get("/documents/:relation", asyncHandler(async (req, res, next) => {

  const allDocuments = await Document.find().populate("owner").populate("category").exec();
  const allOwners = await Owner.find().exec();
  const allCategories = await Category.find({relation: req.params.relation}).exec();

  res.render("main_listing", {
    title: "Document List " + `${req.params.relation}`,
    currPage: "documents" ,
    document_list: allDocuments,
    owners_list: allOwners,
    categories_list: allCategories,
  });
}));

router.post("/documents/:relation", asyncHandler(async (req, res, next) => {

  const owner = await Owner.findById(req.body.ownerId).exec();
  const category = await Category.findById(req.body.categoryId).exec();

  const document = await Document.findOne({
    category: category,
    owner: owner,
  }).exec();
  // Process the request submission

  res.redirect(document.url);

}));

//download instance routes
router.get("/download/:id", asyncHandler(async (req, res, next) => {
  res.download(`./uploads/${req.params.id}`);
}));


module.exports = router;

