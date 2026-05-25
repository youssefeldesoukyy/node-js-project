const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cart.controllers');
const verifyToken = require('../middleware/verifyToken');

router.route('/')
    .get(verifyToken, cartController.getMyCart)
    .post(verifyToken, cartController.addToCart)
    .delete(verifyToken, cartController.clearCart);


router.route('/checkout')
    .post(verifyToken, cartController.checkout);


    router.route('/:productId')
    .patch(verifyToken, cartController.updateCartItem)
    .delete(verifyToken, cartController.removeFromCart);

module.exports = router;
