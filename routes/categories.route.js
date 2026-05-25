const express = require('express');
const router = express.Router();
const categoriesController = require('../controllers/categories.controllers');
const verifyToken = require('../middleware/verifyToken');

router.route('/')
    .get(categoriesController.getAllCategories)
    .post(verifyToken, categoriesController.addCategory);

router.route('/:id')
    .get(categoriesController.getCategory)
    .patch(verifyToken, categoriesController.updateCategory)
    .delete(verifyToken, categoriesController.deleteCategory);

module.exports = router;
