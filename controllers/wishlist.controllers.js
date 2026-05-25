const asyncWrapper = require("../middleware/asyncWrapper");
const mongoose = require("mongoose");
const Wishlist = require('../models/wishlist.model');
const Product = require('../models/product.model');
const ProductImage = require('../models/productImg.model');
const httpStatusText = require('../utils/httpStatus');
const appError = require('../utils/appError');

// ========================
// GET MY WISHLIST
// ========================
const getWishlist = asyncWrapper(async (req, res) => {
    let wishlist = await Wishlist.findOne({ userId: req.currentUser.id })
        .populate({
            path: 'products',
            populate: {
                path: 'userId',
                select: 'firstName lastName email'
            }
        });

    if (!wishlist) {
        return res.json({ status: httpStatusText.SUCCESS, data: { products: [] } });
    }

    // جيب صور كل منتج
    const productsWithImages = await Promise.all(wishlist.products.map(async (product) => {
        const images = await ProductImage.find({ productId: product._id }, { "__v": false });
        return { ...product.toObject(), images };
    }));

    res.json({ status: httpStatusText.SUCCESS, data: { products: productsWithImages } });
})

// ========================
// ADD PRODUCT TO WISHLIST
// ========================
const addToWishlist = asyncWrapper(async (req, res, next) => {
    const { productId } = req.body;

    if (!productId) {
        const error = appError.create('productId is required', 400, httpStatusText.FAIL);
        return next(error);
    }

    // تأكد إن المنتج موجود
    const product = await Product.findById(productId);
    if (!product) {
        const error = appError.create('product not found', 404, httpStatusText.FAIL);
        return next(error);
    }
    if (product.status === 'sold') {
        const error = appError.create('this item has already been sold', 400, httpStatusText.FAIL);
        return next(error);
    }
    if (product.status !== 'available') {
        const error = appError.create('this item is not available', 400, httpStatusText.FAIL);
        return next(error);
    }

    // لو الـ wishlist مش موجودة، اعملها
    let wishlist = await Wishlist.findOne({ userId: req.currentUser.id });

    if (!wishlist) {
        wishlist = new Wishlist({
            userId: req.currentUser.id,
            products: [productId]
        });
    } else {
        // تأكد إن المنتج مش موجود بالفعل في الـ wishlist
        const alreadyListed = wishlist.products.some(
            (id) => id.toString() === String(productId)
        );
        if (alreadyListed) {
            const error = appError.create('product already in wishlist', 400, httpStatusText.FAIL);
            return next(error);
        }
        wishlist.products.push(productId);
    }

    await wishlist.save();

    res.status(201).json({ status: httpStatusText.SUCCESS, data: { wishlist } });
})

// ========================
// REMOVE PRODUCT FROM WISHLIST
// ========================
const removeFromWishlist = asyncWrapper(async (req, res, next) => {
    const { productId } = req.params;

    if (!mongoose.isValidObjectId(productId)) {
        const error = appError.create('invalid product id', 400, httpStatusText.FAIL);
        return next(error);
    }

    const wishlist = await Wishlist.findOne({ userId: req.currentUser.id });

    if (!wishlist) {
        const error = appError.create('wishlist not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    const inList = wishlist.products.some((id) => id.toString() === productId);
    if (!inList) {
        const error = appError.create('product not in wishlist', 404, httpStatusText.FAIL);
        return next(error);
    }

    // شيل المنتج من الـ wishlist
    wishlist.products = wishlist.products.filter(
        (id) => id.toString() !== productId
    );

    await wishlist.save();

    res.json({ status: httpStatusText.SUCCESS, data: { wishlist } });
})

// ========================
// CLEAR WISHLIST
// ========================
const clearWishlist = asyncWrapper(async (req, res, next) => {
    const wishlist = await Wishlist.findOne({ userId: req.currentUser.id });

    if (!wishlist) {
        const error = appError.create('wishlist not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    wishlist.products = [];
    await wishlist.save();

    res.json({ status: httpStatusText.SUCCESS, data: { wishlist } });
})

module.exports = { getWishlist, addToWishlist, removeFromWishlist, clearWishlist }
