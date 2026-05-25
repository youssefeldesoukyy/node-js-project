const Product = require('../models/product.model');

/**
 * Set order line-item products back to available (e.g. after admin rejects a pending order).
 * @param {Array<{ productId: import('mongoose').Types.ObjectId | string }>} lineItems
 */
async function releaseProducts(lineItems) {
    if (!lineItems || !lineItems.length) return;
    const ids = lineItems
        .map((item) => item && item.productId)
        .filter(Boolean);
    if (!ids.length) return;
    await Product.updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'available' } }
    );
}

module.exports = { releaseProducts };
