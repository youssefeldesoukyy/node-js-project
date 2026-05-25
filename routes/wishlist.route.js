const express = require('express');
const router = express.Router();
const wishlistController = require('../controllers/wishlist.controllers');
const verifyToken = require('../middleware/verifyToken');

// get my wishlist
router.route('/')
    .get(verifyToken, wishlistController.getWishlist)
    .post(verifyToken, wishlistController.addToWishlist)
    .delete(verifyToken, wishlistController.clearWishlist)

// remove single product from wishlist
router.route('/:productId')
    .delete(verifyToken, wishlistController.removeFromWishlist)

module.exports = router;