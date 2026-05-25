const asyncWrapper = require("../middleware/asyncWrapper");
const mongoose = require("mongoose");
const Cart = require('../models/cart.model');
const Product = require('../models/product.model');
const ProductImage = require('../models/productImg.model');
const httpStatusText = require('../utils/httpStatus');
const appError = require('../utils/appError');
const { markProductsAsSold } = require('../utils/markProductsSold');

/** Fixed delivery charge (override with SHIPPING_FEE in .env). */
const SHIPPING_FEE = (() => {
    const n = Number(process.env.SHIPPING_FEE);
    return Number.isFinite(n) && n >= 0 ? n : 70;
})();

function shippingFeeForCart(cart) {
    if (!cart || !Array.isArray(cart.products) || cart.products.length === 0) return 0;
    return SHIPPING_FEE;
}

/** `totalAmount` on the cart document = subtotal (items only). Adds shippingFee + grandTotal for API. */
function enrichCartForResponse(cartDoc) {
    if (!cartDoc) return null;
    const cart = cartDoc.toObject ? cartDoc.toObject() : { ...cartDoc };
    const subtotal = cart.totalAmount || 0;
    const shippingFee = shippingFeeForCart(cart);
    const grandTotal = subtotal + shippingFee;
    return { ...cart, subtotal, shippingFee, grandTotal };
}

/** Populated product may already be a plain object after `.toObject()` on the line. */
function productToPlain(product) {
    if (!product) return null;
    if (typeof product.toObject === 'function') return product.toObject();
    if (typeof product === 'object') return product;
    return null;
}

const recalculateTotalAmount = async (cart) => {
    let totalAmount = 0;

    for (const item of cart.products) {
        const product = await Product.findById(item.productId);
        if (!product) {
            const error = appError.create(`product ${item.productId} not found`, 404, httpStatusText.FAIL);
            throw error;
        }
        totalAmount += product.price * item.quantity;
    }

    cart.totalAmount = totalAmount;
};

// ========================
// GET MY CART
// ========================
const getMyCart = asyncWrapper(async (req, res) => {
    const cart = await Cart.findOne({ userId: req.currentUser.id })
        .populate('products.productId', 'description brand price status isApproved color size');

    if (!cart) {
        return res.json({
            status: httpStatusText.SUCCESS,
            data: {
                cart: {
                    cartId: null,
                    userId: req.currentUser.id,
                    products: [],
                    totalAmount: 0,
                    subtotal: 0,
                    shippingFee: 0,
                    grandTotal: 0
                }
            }
        });
    }

    const cartOut = enrichCartForResponse(cart);
    cartOut.products = await Promise.all(
        cart.products.map(async (item) => {
            const line = item.toObject ? item.toObject() : { ...item };
            const productPlain = productToPlain(line.productId);
            if (!productPlain || !productPlain._id) return line;
            try {
                const images = await ProductImage.find(
                    { productId: productPlain._id },
                    { __v: false }
                );
                return {
                    ...line,
                    productId: { ...productPlain, images },
                };
            } catch (imgErr) {
                return { ...line, productId: productPlain };
            }
        })
    );

    res.json({ status: httpStatusText.SUCCESS, data: { cart: cartOut } });
});

// ========================
// ADD PRODUCT TO CART
// ========================
const addToCart = asyncWrapper(async (req, res, next) => {
    const { productId, quantity = 1 } = req.body;

    if (!productId) {
        const error = appError.create('productId is required', 400, httpStatusText.FAIL);
        return next(error);
    }

    if (!mongoose.isValidObjectId(productId)) {
        const error = appError.create('invalid product id', 400, httpStatusText.FAIL);
        return next(error);
    }

    if (quantity < 1) {
        const error = appError.create('quantity must be at least 1', 400, httpStatusText.FAIL);
        return next(error);
    }

    const product = await Product.findById(productId);
    if (!product) {
        const error = appError.create('product not found', 404, httpStatusText.FAIL);
        return next(error);
    }
    if (product.status === 'sold') {
        const error = appError.create('this item has already been sold', 400, httpStatusText.FAIL);
        return next(error);
    }
    let cart = await Cart.findOne({ userId: req.currentUser.id });
    if (!cart) {
        cart = new Cart({
            userId: req.currentUser.id,
            products: [{ productId, quantity }]
        });
    } else {
        const existingIndex = cart.products.findIndex((item) => item.productId.toString() === productId);
        if (existingIndex >= 0) {
            cart.products[existingIndex].quantity += quantity;
        } else {
            cart.products.push({ productId, quantity });
        }
    }

    await recalculateTotalAmount(cart);
    await cart.save();

    res.status(201).json({ status: httpStatusText.SUCCESS, data: { cart: enrichCartForResponse(cart) } });
});

// ========================
// UPDATE CART ITEM QUANTITY
// ========================
const updateCartItem = asyncWrapper(async (req, res, next) => {
    const { productId } = req.params;
    const { quantity } = req.body;

    if (!mongoose.isValidObjectId(productId)) {
        const error = appError.create('invalid product id', 400, httpStatusText.FAIL);
        return next(error);
    }

    if (!quantity || quantity < 1) {
        const error = appError.create('quantity must be at least 1', 400, httpStatusText.FAIL);
        return next(error);
    }

    const cart = await Cart.findOne({ userId: req.currentUser.id });
    if (!cart) {
        const error = appError.create('cart not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    const item = cart.products.find((product) => product.productId.toString() === productId);
    if (!item) {
        const error = appError.create('product not in cart', 404, httpStatusText.FAIL);
        return next(error);
    }

    item.quantity = quantity;

    await recalculateTotalAmount(cart);
    await cart.save();

    res.json({ status: httpStatusText.SUCCESS, data: { cart: enrichCartForResponse(cart) } });
});

// ========================
// REMOVE PRODUCT FROM CART
// ========================
const removeFromCart = asyncWrapper(async (req, res, next) => {
    const { productId } = req.params;

    if (!mongoose.isValidObjectId(productId)) {
        const error = appError.create('invalid product id', 400, httpStatusText.FAIL);
        return next(error);
    }

    const cart = await Cart.findOne({ userId: req.currentUser.id });
    if (!cart) {
        const error = appError.create('cart not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    const inCart = cart.products.some((product) => product.productId.toString() === productId);
    if (!inCart) {
        const error = appError.create('product not in cart', 404, httpStatusText.FAIL);
        return next(error);
    }

    cart.products = cart.products.filter((product) => product.productId.toString() !== productId);

    await recalculateTotalAmount(cart);
    await cart.save();

    res.json({ status: httpStatusText.SUCCESS, data: { cart: enrichCartForResponse(cart) } });
});

// ========================
// CLEAR CART
// ========================
const clearCart = asyncWrapper(async (req, res, next) => {
    const cart = await Cart.findOne({ userId: req.currentUser.id });
    if (!cart) {
        const error = appError.create('cart not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    cart.products = [];
    cart.totalAmount = 0;

    await cart.save();

    res.json({ status: httpStatusText.SUCCESS, data: { cart: enrichCartForResponse(cart) } });
});

// ========================
// CHECKOUT
// ========================
const checkout = asyncWrapper(async (req, res, next) => {
    const { address } = req.body;

    if (!address) {
        const error = appError.create('address is required', 400, httpStatusText.FAIL);
        return next(error);
    }

    const cart = await Cart.findOne({ userId: req.currentUser.id });

    if (!cart || cart.products.length === 0) {
        const error = appError.create('cart is empty', 400, httpStatusText.FAIL);
        return next(error);
    }

    const Order = require('../models/order.model');

    for (const item of cart.products) {
        const product = await Product.findById(item.productId);
        if (!product) {
            const error = appError.create('a product in your cart was not found', 404, httpStatusText.FAIL);
            return next(error);
        }
        if (product.status !== 'available') {
            const error = appError.create(
                'an item in your cart is no longer available — refresh your cart',
                400,
                httpStatusText.FAIL
            );
            return next(error);
        }
    }

    const subtotal = cart.totalAmount;
    const shippingFee = shippingFeeForCart(cart);
    const grandTotal = subtotal + shippingFee;

    const newOrder = new Order({
        userId: req.currentUser.id,
        address,
        products: cart.products,
        amount: grandTotal,
        status: 'delivered',
    });

    await newOrder.save();
    await markProductsAsSold(cart.products);

    // فضي الـ cart بعد الـ checkout
    cart.products = [];
    cart.totalAmount = 0;
    await cart.save();

    res.status(201).json({
        status: httpStatusText.SUCCESS,
        data: {
            order: {
                ...newOrder.toObject(),
                subtotal,
                shippingFee
            }
        }
    });
});

module.exports = { getMyCart, addToCart, updateCartItem, removeFromCart, clearCart, checkout };