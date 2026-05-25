const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controllers');
const verifyToken = require('../middleware/verifyToken');

// get all payments (admin)
router.route('/')
    .get(verifyToken, paymentController.getAllPayments)

// cash payment
router.route('/cash')
    .post(verifyToken, paymentController.createCashPayment)

// stripe publishable key (public — no auth)
router.get('/stripe/config', paymentController.getStripePublicConfig);

// stripe payment
router.route('/stripe')
    .post(verifyToken, paymentController.createStripePayment)

// confirm stripe payment
router.route('/stripe/confirm')
    .post(verifyToken, paymentController.confirmStripePayment)

// single payment
router.route('/:id')
    .get(verifyToken, paymentController.getPayment)
    .patch(verifyToken, paymentController.updatePaymentStatus)

module.exports = router;