const mongoose = require('mongoose');

const cartProductSchema = new mongoose.Schema(
    {
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 1,
            default: 1
        }
    },
    { _id: false }
);

const cartSchema = new mongoose.Schema(
    {
        cartId: {
            type: String,
            unique: true,
            default: () => `CART-${Date.now()}-${Math.floor(Math.random() * 100000)}`
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true
        },
        products: [cartProductSchema],
        totalAmount: {
            type: Number,
            default: 0
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model('Cart', cartSchema);
