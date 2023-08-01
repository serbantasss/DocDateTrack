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

/**
 DOCUMENT ROUTES.
 */

//GET request to create document.
router.get("/document/create", document_controller.document_create_get);

//POST request to create document.
router.post("/document/create", document_controller.document_create_post);

//DELETE request to remove document.
router.delete("/delete/document/:id", document_controller.document_delete);

//GET request for one document info.
router.get("/document/:id", document_controller.document_detail);

//GET request for list of documents.
router.get("/documents", document_controller.document_list);

//GET request for list of documents filtered by relation.
router.get("/documents/:relation", document_controller.document_list);

/**
  OWNER ROUTES.
 */

//GET request to create owner.
router.get("/owner/create", owner_controller.owner_create_get);

//POST request to create owner.
router.post("/owner/create", owner_controller.owner_create_post);

//GET request for specified owner information.
router.get("/owner/:id", owner_controller.owner_detail);

//DELETE request for specified owner.
router.delete("/delete/owner/:id", owner_controller.owner_delete);

//GET request for list of owners.
router.get("/owners", owner_controller.owners_list);

/**
 CATEGORY ROUTES.
 */

//GET request to create category.
router.get("/category/create", category_controller.category_create_get);

//POST request to create category.
router.post("/category/create", category_controller.category_create_post);

//GET request for one category info.
router.get("/category/:id", category_controller.category_detail);

//DELETE request for one category.
router.delete("/delete/category/:id", category_controller.category_delete);

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

//GET request to download document instance file.
router.get("/document_instance/download/:id", document_instance.document_instance_download_get);

//DELETE request to delete document instance file.
router.delete("/delete/document_instance/:id", document_instance_controller.document_instance_delete);

//GET request to edit document instance file.
router.get("/edit/document_instance/:id", document_instance_controller.document_instance_edit_get);

//POST request to delete document instance file.
router.post("/edit/document_instance/:id", document_instance_controller.document_instance_edit_post);


//
/**
 * EXTRA ROUTES
 */




module.exports = router;

