const asyncWrapper = require("../middleware/asyncWrapper");
const Payment = require('../models/payment.model');
const Order = require('../models/order.model');
const httpStatusText = require('../utils/httpStatus');
const appError = require('../utils/appError');
const { getStripe } = require('../utils/stripeClient');
const {
    sendOrderConfirmationIfNeeded,
} = require('../services/orderConfirmationEmail.service');

// ========================
// GET ALL PAYMENTS (ADMIN)
// ========================
const getAllPayments = asyncWrapper(async (req, res, next) => {
    if (req.currentUser.role !== 'ADMIN') {
        const error = appError.create('you are not authorized', 403, httpStatusText.FAIL);
        return next(error);
    }

    const payments = await Payment.find().populate('orderId');
    res.json({ status: httpStatusText.SUCCESS, data: { payments } });
})

// ========================
// GET SINGLE PAYMENT
// ========================
const getPayment = asyncWrapper(async (req, res, next) => {
    const payment = await Payment.findById(req.params.id)
        .populate({
            path: 'orderId',
            populate: {
                path: 'userId',
                select: 'firstName lastName email'
            }
        });

    if (!payment) {
        const error = appError.create('payment not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    res.json({ status: httpStatusText.SUCCESS, data: { payment } });
})

// ========================
// STRIPE PUBLIC CONFIG (publishable key for frontend)
// ========================
const getStripePublicConfig = asyncWrapper(async (req, res) => {
    const pk = String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
    const stripe = getStripe();
    res.json({
        status: httpStatusText.SUCCESS,
        data: {
            publishableKey: pk.startsWith('pk_') ? pk : '',
            stripeEnabled: !!(stripe && pk.startsWith('pk_')),
        },
    });
});

// ========================
// CREATE CASH PAYMENT
// ========================
const createCashPayment = asyncWrapper(async (req, res, next) => {
    const { orderId } = req.body;

    if (!orderId) {
        const error = appError.create('orderId is required', 400, httpStatusText.FAIL);
        return next(error);
    }

    const order = await Order.findById(orderId);
    if (!order) {
        const error = appError.create('order not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    if (order.userId.toString() !== req.currentUser.id) {
        const error = appError.create('you are not authorized', 403, httpStatusText.FAIL);
        return next(error);
    }

    const existingPayment = await Payment.findOne({ orderId });
    if (existingPayment) {
        const error = appError.create('payment already exists for this order', 400, httpStatusText.FAIL);
        return next(error);
    }

    const newPayment = new Payment({
        orderId,
        paymentMethod: 'cash',
        amount: order.amount,
        paymentStatus: 'pending',
        paymentDate: Date.now()
    });

    await newPayment.save();

    sendOrderConfirmationIfNeeded(orderId, {
        paymentLabel: 'Cash on delivery',
    }).catch((err) => console.error('[order-email] COD:', err.message));

    res.status(201).json({ status: httpStatusText.SUCCESS, data: { payment: newPayment } });
})

// ========================
// CREATE STRIPE PAYMENT INTENT
// ========================
const createStripePayment = asyncWrapper(async (req, res, next) => {
    const { orderId } = req.body;

    if (!orderId) {
        const error = appError.create('orderId is required', 400, httpStatusText.FAIL);
        return next(error);
    }

    const order = await Order.findById(orderId);
    if (!order) {
        const error = appError.create('order not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    if (order.userId.toString() !== req.currentUser.id) {
        const error = appError.create('you are not authorized', 403, httpStatusText.FAIL);
        return next(error);
    }

    const existingPayment = await Payment.findOne({ orderId });
    if (existingPayment) {
        const error = appError.create('payment already exists for this order', 400, httpStatusText.FAIL);
        return next(error);
    }

    const stripe = getStripe();
    if (!stripe) {
        const error = appError.create('Stripe is not configured (set STRIPE_SECRET_KEY)', 503, httpStatusText.FAIL);
        return next(error);
    }

    const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(order.amount * 100),
        currency: 'egp',
        automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
        },
        metadata: {
            orderId: String(orderId),
            userId: String(req.currentUser.id),
        },
    });

    // احفظ الـ payment في الـ DB
    const newPayment = new Payment({
        orderId,
        paymentMethod: 'card',
        amount: order.amount,
        paymentStatus: 'pending',
        transactionId: paymentIntent.id,
        paymentDate: Date.now()
    });

    await newPayment.save();

    res.status(201).json({
        status: httpStatusText.SUCCESS,
        data: {
            clientSecret: paymentIntent.client_secret,
            payment: newPayment
        }
    });
})

// ========================
// CONFIRM STRIPE PAYMENT
// ========================
const confirmStripePayment = asyncWrapper(async (req, res, next) => {
    const { transactionId } = req.body;

    if (!transactionId) {
        const error = appError.create('transactionId is required', 400, httpStatusText.FAIL);
        return next(error);
    }

    const stripe = getStripe();
    if (!stripe) {
        const error = appError.create('Stripe is not configured (set STRIPE_SECRET_KEY)', 503, httpStatusText.FAIL);
        return next(error);
    }

    // تأكد من الـ payment على Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(transactionId);

    if (paymentIntent.status === 'succeeded') {
        // حدث الـ payment في الـ DB
        const payment = await Payment.findOneAndUpdate(
            { transactionId },
            { $set: { paymentStatus: 'completed' } },
            { new: true }
        );

        await Order.findByIdAndUpdate(
            payment.orderId,
            { $set: { status: 'confirmed' } }
        );

        sendOrderConfirmationIfNeeded(payment.orderId, {
            paymentLabel: 'Card (Visa)',
        }).catch((err) => console.error('[order-email] Stripe:', err.message));

        res.json({ status: httpStatusText.SUCCESS, data: { payment } });
    } else {
        const error = appError.create('payment not confirmed yet', 400, httpStatusText.FAIL);
        return next(error);
    }
})

// ========================
// UPDATE PAYMENT STATUS (ADMIN)
// ========================
const updatePaymentStatus = asyncWrapper(async (req, res, next) => {
    if (req.currentUser.role !== 'ADMIN') {
        const error = appError.create('you are not authorized', 403, httpStatusText.FAIL);
        return next(error);
    }

    const { paymentStatus } = req.body;

    const payment = await Payment.findByIdAndUpdate(
        req.params.id,
        { $set: { paymentStatus } },
        { new: true }
    );

    if (!payment) {
        const error = appError.create('payment not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    if (paymentStatus === 'completed') {
        await Order.findByIdAndUpdate(
            payment.orderId,
            { $set: { status: 'confirmed' } }
        );
        sendOrderConfirmationIfNeeded(payment.orderId, {
            paymentLabel: 'Payment completed',
        }).catch((err) => console.error('[order-email] Admin:', err.message));
    }

    res.json({ status: httpStatusText.SUCCESS, data: { payment } });
})

/**
 * Stripe dashboard webhook (raw body). Requires STRIPE_WEBHOOK_SECRET.
 */
async function stripeWebhook(req, res) {
    const stripe = getStripe();
    if (!stripe) {
        return res.status(503).json({ error: 'Stripe is not configured' });
    }
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!whSecret) {
        return res.status(503).json({ error: 'STRIPE_WEBHOOK_SECRET is not set' });
    }
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, whSecret);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    if (event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed') {
        // Extend here if you need DB updates from webhooks
    }
    res.json({ received: true });
}

module.exports = {
    getAllPayments,
    getPayment,
    getStripePublicConfig,
    createCashPayment,
    createStripePayment,
    confirmStripePayment,
    updatePaymentStatus,
    stripeWebhook,
};