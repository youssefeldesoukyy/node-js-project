const express = require('express');
const router = express.Router();
const ordersController = require('../controllers/orders.controllers');
const verifyToken = require('../middleware/verifyToken');

// admin - get all orders
router.route('/')
    .get(verifyToken, ordersController.getAllOrders)
    .post(verifyToken, ordersController.createOrder)

// get my orders
router.route('/myorders')
    .get(verifyToken, ordersController.getMyOrders)

// single order
router.route('/:id')
    .get(verifyToken, ordersController.getOrder)

// update order status (admin)
router.route('/:id/status')
    .patch(verifyToken, ordersController.updateOrderStatus)

// admin approve / reject pending orders
router.route('/:id/approve')
    .patch(verifyToken, ordersController.approveOrder)

router.route('/:id/reject')
    .patch(verifyToken, ordersController.rejectOrder)

// cancel order
router.route('/:id/cancel')
    .patch(verifyToken, ordersController.cancelOrder)

module.exports = router;