/**
 * Lazy-loaded API routes — parse heavy routes only after Mongo is up.
 */
const express = require('express');

let router = null;

function getApiRouter() {
    if (router) {
        return router;
    }
    router = express.Router();
    router.use(express.json());

    router.use('/courses', require('./routes/courses.route'));
    router.use('/users', require('./routes/users.route'));
    router.use('/products', require('./routes/products.route'));
    router.use('/orders', require('./routes/orders.route'));
    router.use('/wishlist', require('./routes/wishlist.route'));
    router.use('/reviews', require('./routes/reviews.route'));
    router.use('/carts', require('./routes/cart.route'));
    router.use('/categories', require('./routes/categories.route'));
    router.use('/payments', require('./routes/payments.route'));

    return router;
}

module.exports = getApiRouter;
