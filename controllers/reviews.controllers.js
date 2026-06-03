const asyncWrapper = require("../middleware/asyncWrapper");
const mongoose = require('mongoose');
const Review = require('../models/review.model');
const Order = require('../models/order.model');
const httpStatusText = require('../utils/httpStatus');
const appError = require('../utils/appError');

/** Buyers may review only after admin marks the order as received (delivered). */
const REVIEWABLE_ORDER_STATUSES = ['delivered'];

function sellerDisplayName(user) {
    if (!user) return 'Seller';
    const first = user.firstName ? String(user.firstName).trim() : '';
    const last = user.lastName ? String(user.lastName).trim() : '';
    const combined = [first, last].filter(Boolean).join(' ').trim();
    return combined || 'Seller';
}

function productDisplayName(product) {
    if (!product || typeof product !== 'object') return 'Item';
    return (
        product.description ||
        product.brand ||
        product.name ||
        'Item'
    );
}

// ========================
// GET ALL REVIEWS ON A SELLER
// ========================
const getSellerReviews = asyncWrapper(async (req, res, next) => {
    const { sellerId } = req.params;

    const reviews = await Review.find({ sellerId })
        .populate('buyerId', 'firstName lastName')
        .populate('productId', 'description brand price')
        .populate('orderId');

    res.json({ status: httpStatusText.SUCCESS, data: { reviews } });
})

// ========================
// GET SINGLE REVIEW
// ========================
const getReview = asyncWrapper(async (req, res, next) => {
    const review = await Review.findById(req.params.id)
        .populate('buyerId', 'firstName lastName')
        .populate('sellerId', 'firstName lastName')
        .populate('productId', 'description brand price')
        .populate('orderId');

    if (!review) {
        const error = appError.create('review not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    res.json({ status: httpStatusText.SUCCESS, data: { review } });
})

// ========================
// ADD REVIEW
// ========================
const addReview = asyncWrapper(async (req, res, next) => {
    const { sellerId, orderId, productId, rating, comment } = req.body;

    if (!sellerId || !orderId || !productId || !rating) {
        const error = appError.create('sellerId, orderId, productId and rating are required', 400, httpStatusText.FAIL);
        return next(error);
    }

    // تأكد إن الـ rating بين 1 و 5
    if (rating < 1 || rating > 5) {
        const error = appError.create('rating must be between 1 and 5', 400, httpStatusText.FAIL);
        return next(error);
    }

    // تأكد إن الأوردر موجود وتاع المشتري
    const order = await Order.findOne({
        _id: orderId,
        userId: req.currentUser.id,
        status: { $in: REVIEWABLE_ORDER_STATUSES },
    }).populate({
        path: 'products.productId',
        select: 'userId description brand',
    });

    if (!order) {
        const error = appError.create('you can only review after your order has been received', 400, httpStatusText.FAIL);
        return next(error);
    }

    const line = order.products.find(
        (item) => item.productId && item.productId._id.toString() === String(productId)
    );
    if (!line || !line.productId) {
        const error = appError.create('product is not part of this order', 400, httpStatusText.FAIL);
        return next(error);
    }

    const productSellerId = line.productId.userId
        ? line.productId.userId.toString()
        : '';
    if (productSellerId && productSellerId !== String(sellerId)) {
        const error = appError.create('seller does not match this product', 400, httpStatusText.FAIL);
        return next(error);
    }

    // تأكد إن المشتري مش عمل review قبل كده على نفس الأوردر
    const existingReview = await Review.findOne({
        orderId,
        buyerId: req.currentUser.id,
        productId
    });

    if (existingReview) {
        const error = appError.create('you already reviewed this product', 400, httpStatusText.FAIL);
        return next(error);
    }

    const newReview = new Review({
        sellerId,
        buyerId: req.currentUser.id,
        orderId,
        productId,
        rating,
        comment,
        isVerified: true
    });

    await newReview.save();

    res.status(201).json({ status: httpStatusText.SUCCESS, data: { review: newReview } });
})

// ========================
// UPDATE REVIEW
// ========================
const updateReview = asyncWrapper(async (req, res, next) => {
    const review = await Review.findById(req.params.id);

    if (!review) {
        const error = appError.create('review not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    // تأكد إن اليوزر هو صاحب الـ review
    if (review.buyerId.toString() !== req.currentUser.id) {
        const error = appError.create('you are not authorized to update this review', 403, httpStatusText.FAIL);
        return next(error);
    }

    const { rating, comment } = req.body;

    if (rating && (rating < 1 || rating > 5)) {
        const error = appError.create('rating must be between 1 and 5', 400, httpStatusText.FAIL);
        return next(error);
    }

    const updatedReview = await Review.findByIdAndUpdate(
        req.params.id,
        { $set: { rating, comment } },
        { new: true }
    );

    res.json({ status: httpStatusText.SUCCESS, data: { review: updatedReview } });
})

// ========================
// DELETE REVIEW
// ========================
const deleteReview = asyncWrapper(async (req, res, next) => {
    const review = await Review.findById(req.params.id);

    if (!review) {
        const error = appError.create('review not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    if (review.buyerId.toString() !== req.currentUser.id && req.currentUser.role !== 'ADMIN') {
        const error = appError.create('you are not authorized to delete this review', 403, httpStatusText.FAIL);
        return next(error);
    }

    await Review.findByIdAndDelete(req.params.id);

    res.json({ status: httpStatusText.SUCCESS, data: null });
})

// ========================
// GET AVERAGE RATING FOR SELLER
// ========================
const getSellerRating = asyncWrapper(async (req, res, next) => {
    const { sellerId } = req.params;

    if (!mongoose.isValidObjectId(sellerId)) {
        const error = appError.create('invalid seller id', 400, httpStatusText.FAIL);
        return next(error);
    }

    const result = await Review.aggregate([
        { $match: { sellerId: new mongoose.Types.ObjectId(sellerId) } },
        { $group: { _id: '$sellerId', averageRating: { $avg: '$rating' }, totalReviews: { $sum: 1 } } },
    ]);

    const rating = result[0] || { averageRating: 0, totalReviews: 0 };

    res.json({ status: httpStatusText.SUCCESS, data: { rating } });
});

const getReviewablePurchases = asyncWrapper(async (req, res) => {
    const orders = await Order.find({
        userId: req.currentUser.id,
        status: { $in: REVIEWABLE_ORDER_STATUSES },
    })
        .sort({ createdAt: -1 })
        .populate({
            path: 'products.productId',
            populate: { path: 'userId', select: 'firstName lastName email' },
        });

    const items = [];

    for (const order of orders) {
        for (const line of order.products) {
            const product = line.productId;
            if (!product || typeof product !== 'object' || !product._id) continue;

            const productId = product._id;
            const seller = product.userId;
            const sellerId =
                seller && seller._id ? seller._id : product.userId;

            if (!sellerId) continue;

            const existing = await Review.findOne({
                orderId: order._id,
                buyerId: req.currentUser.id,
                productId,
            });

            if (existing) continue;

            items.push({
                orderId: order._id,
                productId,
                sellerId,
                sellerName: sellerDisplayName(seller),
                productName: productDisplayName(product),
                orderDate: order.createdAt,
            });
        }
    }

    res.json({ status: httpStatusText.SUCCESS, data: { items } });
});

const getMyWrittenReviews = asyncWrapper(async (req, res) => {
    const reviews = await Review.find({ buyerId: req.currentUser.id })
        .sort({ createdAt: -1 })
        .populate('sellerId', 'firstName lastName email')
        .populate('productId', 'description brand price');

    res.json({ status: httpStatusText.SUCCESS, data: { reviews } });
});

module.exports = {
    getSellerReviews,
    getReview,
    addReview,
    updateReview,
    deleteReview,
    getSellerRating,
    getReviewablePurchases,
    getMyWrittenReviews,
};