const asyncWrapper = require("../middleware/asyncWrapper");
const Order = require('../models/order.model');
const Product = require('../models/product.model');
const httpStatusText = require('../utils/httpStatus');
const appError = require('../utils/appError');
const { markProductsAsSold } = require('../utils/markProductsSold');
const { releaseProducts } = require('../utils/releaseProducts');
const {
    sendOrderApprovedEmails,
    sendOrderRejectedEmails,
    sendOrderShippedEmails,
} = require('../services/orderApprovalEmail.service');

const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

// ========================
// GET ALL ORDERS (ADMIN)
// ========================
const getAllOrders = asyncWrapper(async (req, res, next) => {
    if (req.currentUser.role !== 'ADMIN') {
        const error = appError.create('you are not authorized', 403, httpStatusText.FAIL);
        return next(error);
    }

    const orders = await Order.find()
        .sort({ createdAt: -1 })
        .populate('userId', 'firstName lastName email')
        .populate({
            path: 'products.productId',
            populate: { path: 'userId', select: 'firstName lastName email' },
        });

    res.json({ status: httpStatusText.SUCCESS, data: { orders } });
})

// ========================
// GET MY ORDERS
// ========================
const getMyOrders = asyncWrapper(async (req, res) => {
    const orders = await Order.find({ userId: req.currentUser.id })
        .sort({ createdAt: -1 })
        .populate('products.productId');

    res.json({ status: httpStatusText.SUCCESS, data: { orders } });
})

// ========================
// GET SINGLE ORDER
// ========================
const getOrder = asyncWrapper(async (req, res, next) => {
    const order = await Order.findById(req.params.id)
        .populate('userId', 'firstName lastName email')
        .populate('products.productId');

    if (!order) {
        const error = appError.create('order not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    // التأكد إن اليوزر هو صاحب الأوردر أو admin
    if (order.userId._id.toString() !== req.currentUser.id && req.currentUser.role !== 'ADMIN') {
        const error = appError.create('you are not authorized', 403, httpStatusText.FAIL);
        return next(error);
    }

    res.json({ status: httpStatusText.SUCCESS, data: { order } });
})

// ========================
// CREATE ORDER
// ========================
const createOrder = asyncWrapper(async (req, res, next) => {
    const { address, products } = req.body;

    if (!address || !products || products.length === 0) {
        const error = appError.create('address and products are required', 400, httpStatusText.FAIL);
        return next(error);
    }

    // حساب الـ amount من أسعار المنتجات
    let amount = 0;
    for (const item of products) {
        const product = await Product.findById(item.productId);
        if (!product) {
            const error = appError.create(`product ${item.productId} not found`, 404, httpStatusText.FAIL);
            return next(error);
        }
        if (product.status === 'sold') {
            const error = appError.create(`product ${item.productId} has already been sold`, 400, httpStatusText.FAIL);
            return next(error);
        }
        if (product.status !== 'available') {
            const error = appError.create(`product ${item.productId} is not available`, 400, httpStatusText.FAIL);
            return next(error);
        }
        amount += product.price * (item.quantity || 1);
    }

    const newOrder = new Order({
        userId: req.currentUser.id,
        address,
        products,
        amount,
        status: 'confirmed',
    });

    await newOrder.save();
    await markProductsAsSold(products);

    res.status(201).json({ status: httpStatusText.SUCCESS, data: { order: newOrder } });
})

// ========================
// UPDATE ORDER STATUS (ADMIN)
// ========================
const updateOrderStatus = asyncWrapper(async (req, res, next) => {
    if (req.currentUser.role !== 'ADMIN') {
        const error = appError.create('you are not authorized', 403, httpStatusText.FAIL);
        return next(error);
    }

    const { status } = req.body;
    const nextStatus = String(status || '').toLowerCase().trim();

    if (!ORDER_STATUSES.includes(nextStatus)) {
        const error = appError.create('invalid order status', 400, httpStatusText.FAIL);
        return next(error);
    }

    const existing = await Order.findById(req.params.id);
    if (!existing) {
        const error = appError.create('order not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    const order = await Order.findByIdAndUpdate(
        req.params.id,
        { $set: { status: nextStatus } },
        { new: true }
    )
        .populate('userId', 'firstName lastName email')
        .populate('products.productId');

    if (nextStatus === 'shipped' && existing.status !== 'shipped') {
        sendOrderShippedEmails(order._id).catch((err) =>
            console.error('[order-email] shipped:', err.message)
        );
    }

    res.json({ status: httpStatusText.SUCCESS, data: { order } });
})

const approveOrder = asyncWrapper(async (req, res, next) => {
    if (req.currentUser.role !== 'ADMIN') {
        const error = appError.create('you are not authorized', 403, httpStatusText.FAIL);
        return next(error);
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
        const error = appError.create('order not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    if (order.status !== 'pending') {
        const error = appError.create('only pending orders can be approved', 400, httpStatusText.FAIL);
        return next(error);
    }

    order.status = 'confirmed';
    await order.save();
    await markProductsAsSold(order.products);

    sendOrderApprovedEmails(order._id).catch((err) =>
        console.error('[order-email] approve:', err.message)
    );

    const populated = await Order.findById(order._id)
        .populate('userId', 'firstName lastName email')
        .populate('products.productId');

    res.json({ status: httpStatusText.SUCCESS, data: { order: populated } });
})

const rejectOrder = asyncWrapper(async (req, res, next) => {
    if (req.currentUser.role !== 'ADMIN') {
        const error = appError.create('you are not authorized', 403, httpStatusText.FAIL);
        return next(error);
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
        const error = appError.create('order not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    if (order.status !== 'pending') {
        const error = appError.create('only pending orders can be rejected', 400, httpStatusText.FAIL);
        return next(error);
    }

    order.status = 'cancelled';
    await order.save();
    await releaseProducts(order.products);

    sendOrderRejectedEmails(order._id).catch((err) =>
        console.error('[order-email] reject:', err.message)
    );

    const populated = await Order.findById(order._id)
        .populate('userId', 'firstName lastName email')
        .populate('products.productId');

    res.json({ status: httpStatusText.SUCCESS, data: { order: populated } });
})

// ========================
// CANCEL ORDER
// ========================
const cancelOrder = asyncWrapper(async (req, res, next) => {
    const order = await Order.findById(req.params.id);

    if (!order) {
        const error = appError.create('order not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    if (order.userId.toString() !== req.currentUser.id) {
        const error = appError.create('you are not authorized', 403, httpStatusText.FAIL);
        return next(error);
    }

    if (order.status !== 'pending') {
        const error = appError.create('only pending orders can be cancelled', 400, httpStatusText.FAIL);
        return next(error);
    }

    order.status = 'cancelled';
    await order.save();

    res.json({ status: httpStatusText.SUCCESS, data: { order } });
})

module.exports = {
    getAllOrders,
    getMyOrders,
    getOrder,
    createOrder,
    updateOrderStatus,
    approveOrder,
    rejectOrder,
    cancelOrder,
}