const Category = require('../models/category.model');
const { ROOT_CATEGORY_NAMES, ALLOWED_SUBCATEGORIES } = require('./categoryConstants');

/**
 * Ensure Men/Women roots and standard subcategories exist (for seller form + product resolution).
 */
async function ensureCatalogCategories() {
    for (const rootName of ROOT_CATEGORY_NAMES) {
        let root = await Category.findOne({ parentId: null, categoryName: rootName });
        if (!root) {
            root = await Category.create({ categoryName: rootName, parentId: null });
            console.log('[categories] created root:', rootName);
        }

        for (const subName of ALLOWED_SUBCATEGORIES) {
            const exists = await Category.findOne({
                parentId: root._id,
                categoryName: subName,
            });
            if (!exists) {
                await Category.create({ categoryName: subName, parentId: root._id });
                console.log('[categories] created subcategory:', rootName, '→', subName);
            }
        }
    }
}

module.exports = ensureCatalogCategories;
