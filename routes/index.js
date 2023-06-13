const express = require('express');
const router = express.Router();

/* GET home page. */
const owner_controller = require("../controllers/ownerController");
const document_controller = require("../controllers/documentController");
const category_controller = require("../controllers/categoryController");
const asyncHandler = require("express-async-handler");
const Document = require("../models/document");
const Owner = require("../models/owner");
const DocumentType = require("../models/category");

//Render Home Page.
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
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
router.get("/document/create", document_controller.document_create_post);

//GET request to remove document.
router.get("/document/:id/delete", document_controller.document_delete_get);

//POST request to remove document.
router.get("/document/:id/delete", document_controller.document_delete_post);

//GET request to update document.
router.get("/document/:id/update", document_controller.document_update_get);

//POST request to update document.
router.get("/document/:id/update", document_controller.document_update_post);

//GET request for list of documents.
router.get("/documents", document_controller.owner_list);

/**
  OWNER ROUTES.
 */

//GET request to create owner.
router.get("/owner/create", owner_controller.owner_create_get);

//POST request to create owner.
router.get("/owner/create", owner_controller.owner_create_post);

//GET request to remove owner.
router.get("/owner/:id/delete", owner_controller.owner_delete_get);

//POST request to remove owner.
router.get("/owner/:id/delete", owner_controller.owner_delete_post);

//GET request to update owner.
router.get("/owner/:id/update", owner_controller.owner_update_get);

//POST request to update owner.
router.get("/owner/:id/update", owner_controller.owner_update_post);

//GET request for list of owners.
router.get("/owners", owner_controller.owner_list);

/**
 CATEGORY ROUTES.
 */

//GET request to create category.
router.get("/category/create", category_controller.category_create_get);

//POST request to create category.
router.get("/category/create", category_controller.category_create_post);

//GET request to remove category.
router.get("/category/:id/delete", category_controller.category_delete_get);

//POST request to remove category.
router.get("/category/:id/delete", category_controller.category_delete_post);

//GET request to update category.
router.get("/category/:id/update", category_controller.category_update_get);

//POST request to update category.
router.get("/category/:id/update", category_controller.category_update_post);

//GET request for list of categories.
router.get("/categories", category_controller.category_list);

module.exports = router;
