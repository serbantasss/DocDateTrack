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

//GET request to download document instance file.
router.get("/download/:id", asyncHandler(async (req, res, next) => {
  res.download(`./uploads/${req.params.id}`);
}));

/**
 * EXTRA ROUTES
 */




module.exports = router;

