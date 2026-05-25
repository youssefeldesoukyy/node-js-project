const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
    {
        categoryId: {
            type: String,
            unique: true,
            default: () => `CAT-${Date.now()}-${Math.floor(Math.random() * 100000)}`
        },
        categoryName: {
            type: String,
            required: true,
            trim: true
        },
        parentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            default: null
        }
    },
    { timestamps: true }
);

// Same name allowed under different parents (e.g. "T-Shirt" under Men and under Women).
// Roots (parentId null): use unique pairs so "Men"/"Women" stay single per tier.
categorySchema.index({ parentId: 1, categoryName: 1 }, { unique: true });

module.exports = mongoose.model('Category', categorySchema);