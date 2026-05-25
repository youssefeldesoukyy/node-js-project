const Product = require('../models/product.model');

/**
 * Hold items off the shop while an order awaits admin approval.
 * @param {Array<{ productId: import('mongoose').Types.ObjectId | string }>} lineItems
 */
async function reserveProducts(lineItems) {
    if (!lineItems || !lineItems.length) return;
    const ids = lineItems
        .map((item) => item && item.productId)
        .filter(Boolean);
    if (!ids.length) return;
    await Product.updateMany(
        { _id: { $in: ids }, status: 'available' },
        { $set: { status: 'reserved' } }
    );
}

module.exports = { reserveProducts };
