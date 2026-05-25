const Product = require('../models/product.model');

/**
 * Mark line-item products as sold after a successful order.
 * @param {Array<{ productId: import('mongoose').Types.ObjectId | string }>} lineItems
 */
async function markProductsAsSold(lineItems) {
    if (!lineItems || !lineItems.length) return;
    const ids = lineItems
        .map((item) => item && item.productId)
        .filter(Boolean);
    if (!ids.length) return;
    await Product.updateMany(
        { _id: { $in: ids } },
        { $set: { status: 'sold' } }
    );
}

module.exports = { markProductsAsSold };
