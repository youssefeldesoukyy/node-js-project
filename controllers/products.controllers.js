const asyncWrapper = require("../middleware/asyncWrapper");
const mongoose = require("mongoose");
const Product = require('../models/product.model');
const ProductImage = require('../models/productImg.model');
const Category = require('../models/category.model');
const httpStatusText = require('../utils/httpStatus');
const appError = require('../utils/appError');
const {
    ROOT_CATEGORY_NAMES,
    ALLOWED_SUBCATEGORIES,
    canonicalSubcategoryName
} = require('../utils/categoryConstants');
const { parseAndValidateSize } = require('../utils/productSize');
const { suggestPriceRange } = require('../services/priceSuggestion.service');

/** Map form values like "male"/"female" to schema enum "Male"/"Female". */
function normalizeGender(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const s = String(value).trim().toLowerCase();
    if (s === 'male') return 'Male';
    if (s === 'female') return 'Female';
    if (value === 'Male' || value === 'Female') return value;
    return null;
}

function normalizeCondition(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null;
    const s = String(value).trim().toLowerCase();
    if (s === 'new' || s === 'used') return s;
    return null;
}

function isEmptyBody(v) {
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function handleGroqSuggestError(e, next) {
    if (e.code === 'MISSING_AI_KEY') {
        return next(
            appError.create(
                'AI price suggestion is not configured (set GROQ_API_KEY)',
                503,
                httpStatusText.ERROR
            )
        );
    }
    if (e.code === 'GROQ_ERROR' || e.code === 'GROQ_EMPTY') {
        let message = e.message || 'Groq service error';
        if (e.status === 401 || /invalid api key/i.test(message)) {
            message =
                'Invalid Groq API key — create a new key at console.groq.com and set GROQ_API_KEY in backend .env, then restart npm run run:dev';
        }
        return next(
            appError.create(
                message,
                e.status >= 400 && e.status < 600 ? e.status : 502,
                httpStatusText.ERROR
            )
        );
    }
    return next(appError.create(e.message || 'failed to get price suggestion', 502, httpStatusText.ERROR));
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function productNameForAi(product, override) {
    if (override != null && String(override).trim() !== '') {
        return String(override).trim().slice(0, 500);
    }
    if (product.name != null && String(product.name).trim() !== '') {
        return String(product.name).trim().slice(0, 500);
    }
    return String(product.description || '').trim().slice(0, 500);
}

function resolveListingName(body, description) {
    const fromBody =
        (body.name != null && String(body.name).trim() !== '')
            ? String(body.name).trim()
            : (body.productName != null && String(body.productName).trim() !== '')
                ? String(body.productName).trim()
                : '';
    if (fromBody) return fromBody.slice(0, 120);
    return String(description || '').trim().slice(0, 120);
}

function listedPriceFromSuggestion(suggestion) {
    if (suggestion.suggestedPrice != null && !Number.isNaN(suggestion.suggestedPrice)) {
        return Math.round(suggestion.suggestedPrice * 100) / 100;
    }
    return Math.round(((suggestion.minPrice + suggestion.maxPrice) / 2) * 100) / 100;
}

function buildPriceSuggestionDoc(suggestion) {
    const doc = {
        minPrice: suggestion.minPrice,
        maxPrice: suggestion.maxPrice,
        reason: suggestion.reason,
        currency: suggestion.currency,
        suggestedAt: new Date(),
    };
    if (suggestion.suggestedPrice != null && !Number.isNaN(suggestion.suggestedPrice)) {
        doc.suggestedPrice = suggestion.suggestedPrice;
    }
    return doc;
}

/** Male ↔ Men store section, Female ↔ Women */
function assertGenderMatchesCategoryRoot(gender, rootCategoryName) {
    if (gender === 'Male' && rootCategoryName === 'Men') return true;
    if (gender === 'Female' && rootCategoryName === 'Women') return true;
    return false;
}

/**
 * Products must reference a leaf Category (subcategory) whose parent is Men or Women.
 * @returns resolved Category document or null after calling next(error)
 */
async function resolveProductLeafCategory(categoryId, next) {
    if (!categoryId || !mongoose.isValidObjectId(String(categoryId).trim())) {
        next(appError.create(
            'categoryId is required (ObjectId of a subcategory such as tshirts under Men or Women)',
            400,
            httpStatusText.FAIL
        ));
        return null;
    }
    const leaf = await Category.findById(String(categoryId).trim()).populate({
        path: 'parentId',
        select: 'categoryName parentId'
    });
    if (!leaf) {
        next(appError.create('category not found', 404, httpStatusText.FAIL));
        return null;
    }
    const root = leaf.parentId;
    if (!root || root.parentId != null) {
        next(appError.create(
            'product category must be a subcategory (e.g. tshirts), not the Men/Women root alone',
            400,
            httpStatusText.FAIL
        ));
        return null;
    }
    if (!ROOT_CATEGORY_NAMES.includes(root.categoryName)) {
        next(appError.create('invalid category', 400, httpStatusText.FAIL));
        return null;
    }
    return leaf;
}

/**
 * Resolve leaf category from categoryId, or from parentRoot (Men|Women) + subcategoryName / productCategory.
 */
async function resolveProductLeafFromBody(body, next) {
    const categoryId = body.categoryId;
    const parentRoot = body.parentRoot;
    const subRaw = body.subcategoryName != null && String(body.subcategoryName).trim() !== ''
        ? body.subcategoryName
        : body.productCategory;

    if (!isEmptyBody(categoryId)) {
        return resolveProductLeafCategory(categoryId, next);
    }

    if (!isEmptyBody(parentRoot) && !isEmptyBody(subRaw)) {
        const rootName = String(parentRoot).trim();
        if (!ROOT_CATEGORY_NAMES.includes(rootName)) {
            next(appError.create('parentRoot must be Men or Women', 400, httpStatusText.FAIL));
            return null;
        }
        const sub = canonicalSubcategoryName(subRaw);
        if (!ALLOWED_SUBCATEGORIES.includes(sub)) {
            next(appError.create(
                `subcategory must be one of: ${ALLOWED_SUBCATEGORIES.join(', ')}`,
                400,
                httpStatusText.FAIL
            ));
            return null;
        }
        const root = await Category.findOne({ parentId: null, categoryName: rootName });
        if (!root) {
            next(appError.create('root category not found; create Men/Women in categories first', 404, httpStatusText.FAIL));
            return null;
        }
        const leaf = await Category.findOne({ parentId: root._id, categoryName: sub });
        if (!leaf) {
            next(appError.create(
                'subcategory not found under this parent; create it in POST /api/categories first',
                404,
                httpStatusText.FAIL
            ));
            return null;
        }
        return resolveProductLeafCategory(leaf._id, next);
    }

    next(appError.create(
        'send categoryId (subcategory ObjectId), or parentRoot (Men|Women) with subcategoryName or productCategory (e.g. shirts)',
        400,
        httpStatusText.FAIL
    ));
    return null;
}

// ========================
// GET ALL PRODUCTS
// ========================
const getAllProducts = asyncWrapper(async (req, res) => {
    const query = req.query;
    const limit = Math.max(1, Number.parseInt(query.limit, 10) || 10);
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const skip = (page - 1) * limit;

    // Public catalog: approved listings only (new products are saved with isApproved: true)
    const products = await Product.find(
        { isApproved: true, status: 'available' },
        { "__v": false }
    )
        .populate('userId', 'firstName lastName email')
        .populate({
            path: 'categoryId',
            populate: { path: 'parentId', select: 'categoryName categoryId' }
        })
        .limit(limit)
        .skip(skip);

    // جيب صور كل منتج
    const productsWithImages = await Promise.all(products.map(async (product) => {
        const images = await ProductImage.find({ productId: product._id }, { "__v": false });
        return { ...product.toObject(), images };
    }));

    res.json({ status: httpStatusText.SUCCESS, data: { products: productsWithImages } });
})

// ========================
// GET SINGLE PRODUCT
// ========================
const getProduct = asyncWrapper(async (req, res, next) => {
    const product = await Product.findById(req.params.id)
        .populate('userId', 'firstName lastName email')
        .populate({
            path: 'categoryId',
            populate: { path: 'parentId', select: 'categoryName categoryId' }
        });

    if (!product) {
        const error = appError.create('product not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    // جيب صور المنتج
    const images = await ProductImage.find({ productId: product._id }, { "__v": false });

    res.json({ status: httpStatusText.SUCCESS, data: { product: { ...product.toObject(), images } } });
})

// ========================
// ADD PRODUCT
// ========================
const addProduct = asyncWrapper(async (req, res, next) => {
    const { description, price, size, brand, material, color } = req.body;
    const gender = normalizeGender(req.body.gender);
    const condition = normalizeCondition(req.body.condition);

    const hasCategoryById = !isEmptyBody(req.body.categoryId);
    const hasCategoryByName =
        !isEmptyBody(req.body.parentRoot) &&
        (!isEmptyBody(req.body.subcategoryName) || !isEmptyBody(req.body.productCategory));

    const missing = [];
    if (!hasCategoryById && !hasCategoryByName) {
        missing.push('categoryId or (parentRoot + subcategoryName|productCategory)');
    }
    if (isEmptyBody(description)) missing.push('description');
    if (isEmptyBody(price)) missing.push('price');
    if (isEmptyBody(req.body.condition)) missing.push('condition');
    if (isEmptyBody(brand)) missing.push('brand');
    if (isEmptyBody(material)) missing.push('material');
    if (isEmptyBody(req.body.gender)) missing.push('gender');
    if (isEmptyBody(size)) missing.push('size');
    if (missing.length > 0) {
        const error = appError.create(
            `required: ${missing.join(', ')} (categoryId = subcategory id, condition = new or used, gender = male or female, size = xs/s/m/... or shoe 36-48)`,
            400,
            httpStatusText.FAIL
        );
        return next(error);
    }

    if (!gender) {
        const error = appError.create('gender must be Male or Female (or male/female)', 400, httpStatusText.FAIL);
        return next(error);
    }
    if (!condition) {
        const error = appError.create('condition must be new or used', 400, httpStatusText.FAIL);
        return next(error);
    }

    const priceNum = Number(price);
    if (Number.isNaN(priceNum) || priceNum < 0) {
        const error = appError.create('price must be a valid non-negative number', 400, httpStatusText.FAIL);
        return next(error);
    }

    // لازم يكون فيه صورة واحدة على الأقل
    if (!req.files || req.files.length === 0) {
        const error = appError.create('at least one image is required', 400, httpStatusText.FAIL);
        return next(error);
    }

    const leaf = await resolveProductLeafFromBody(req.body, next);
    if (!leaf) return;

    const rootName = leaf.parentId && leaf.parentId.categoryName;
    if (!assertGenderMatchesCategoryRoot(gender, rootName)) {
        return next(appError.create(
            'gender must match the store section: use Male for Men, Female for Women',
            400,
            httpStatusText.FAIL
        ));
    }
    if (!isEmptyBody(req.body.parentRoot) && String(req.body.parentRoot).trim() !== rootName) {
        return next(appError.create(
            'parentRoot must match the subcategory: Men for Men section, Women for Women section',
            400,
            httpStatusText.FAIL
        ));
    }

    const sizeResult = parseAndValidateSize(size, leaf.categoryName);
    if (!sizeResult.ok) {
        return next(appError.create(sizeResult.message, 400, httpStatusText.FAIL));
    }

    const listingName = resolveListingName(req.body, description);

    // احفظ المنتج
    const newProduct = new Product({
        userId: req.currentUser.id,
        categoryId: leaf._id,
        gender,
        name: listingName,
        description: String(description).trim(),
        price: priceNum,
        condition,
        size: sizeResult.value,
        brand: String(brand).trim(),
        material: String(material).trim(),
        color: color != null && String(color).trim() !== '' ? String(color).trim() : undefined,
        isApproved: false,
        status: 'pending',
    });

    await newProduct.save();

    const productOut = await Product.findById(newProduct._id).populate({
        path: 'categoryId',
        populate: { path: 'parentId', select: 'categoryName categoryId' }
    });

    // احفظ الصور في ProductImages
    const images = await Promise.all(req.files.map(async (file) => {
        const productImage = new ProductImage({
            productId: newProduct._id,
            imageURL: file.filename
        });
        await productImage.save();
        return productImage;
    }));

    res.status(201).json({ status: httpStatusText.SUCCESS, data: { product: productOut, images } });
})

// ========================
// UPDATE PRODUCT
// ========================
const updateProduct = asyncWrapper(async (req, res, next) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        const error = appError.create('product not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    if (product.userId.toString() !== req.currentUser.id) {
        const error = appError.create('you are not authorized to update this product', 403, httpStatusText.FAIL);
        return next(error);
    }

    if (
        isEmptyBody(req.body.categoryId) &&
        !isEmptyBody(req.body.parentRoot) &&
        (!isEmptyBody(req.body.subcategoryName) || !isEmptyBody(req.body.productCategory))
    ) {
        const leaf = await resolveProductLeafFromBody(req.body, next);
        if (!leaf) return;
        req.body.categoryId = leaf._id;
    }

    const allowed = ['name', 'description', 'price', 'condition', 'size', 'brand', 'material', 'color', 'gender', 'categoryId'];
    const patch = {};
    allowed.forEach((key) => {
        if (req.body[key] !== undefined) patch[key] = req.body[key];
    });
    if (req.body.name === undefined && (req.body.productName !== undefined)) {
        patch.name = String(req.body.productName).trim().slice(0, 120);
    }
    if (patch.name !== undefined) {
        patch.name = String(patch.name).trim().slice(0, 120);
        if (!patch.name) delete patch.name;
    }

    if (patch.categoryId !== undefined) {
        const leaf = await resolveProductLeafCategory(patch.categoryId, next);
        if (!leaf) return;
        patch.categoryId = leaf._id;
    }
    if (patch.gender !== undefined) {
        const g = normalizeGender(patch.gender);
        if (!g) {
            return next(appError.create('gender must be Male or Female (or male/female)', 400, httpStatusText.FAIL));
        }
        patch.gender = g;
    }
    if (patch.condition !== undefined) {
        const c = normalizeCondition(patch.condition);
        if (!c) {
            return next(appError.create('condition must be new or used', 400, httpStatusText.FAIL));
        }
        patch.condition = c;
    }
    if (patch.price !== undefined) {
        const p = Number(patch.price);
        if (Number.isNaN(p) || p < 0) {
            return next(appError.create('price must be a valid non-negative number', 400, httpStatusText.FAIL));
        }
        patch.price = p;
    }

    if (patch.size !== undefined || patch.categoryId !== undefined) {
        const effectiveCatId = patch.categoryId !== undefined ? patch.categoryId : product.categoryId;
        const sizeVal = patch.size !== undefined ? patch.size : product.size;
        const leaf = await Category.findById(effectiveCatId);
        if (!leaf) {
            return next(appError.create('category not found', 404, httpStatusText.FAIL));
        }
        const sizeResult = parseAndValidateSize(sizeVal, leaf.categoryName);
        if (!sizeResult.ok) {
            return next(appError.create(sizeResult.message, 400, httpStatusText.FAIL));
        }
        patch.size = sizeResult.value;
    }

    const effectiveGender = patch.gender !== undefined ? patch.gender : product.gender;
    const effCatId = patch.categoryId !== undefined ? patch.categoryId : product.categoryId;
    const rootDoc = await Category.findById(effCatId).populate({
        path: 'parentId',
        select: 'categoryName parentId'
    });
    if (rootDoc && rootDoc.parentId) {
        const rName = rootDoc.parentId.categoryName;
        if (!assertGenderMatchesCategoryRoot(effectiveGender, rName)) {
            return next(appError.create(
                'gender must match the store section: use Male for Men, Female for Women',
                400,
                httpStatusText.FAIL
            ));
        }
    }
    if (!isEmptyBody(req.body.parentRoot) && rootDoc && rootDoc.parentId) {
        if (String(req.body.parentRoot).trim() !== rootDoc.parentId.categoryName) {
            return next(appError.create(
                'parentRoot must match the subcategory: Men for Men section, Women for Women section',
                400,
                httpStatusText.FAIL
            ));
        }
    }

    const updatedProduct = await Product.findByIdAndUpdate(
        req.params.id,
        { $set: patch },
        { new: true }
    ).populate({
        path: 'categoryId',
        populate: { path: 'parentId', select: 'categoryName categoryId' }
    });

    res.json({ status: httpStatusText.SUCCESS, data: { product: updatedProduct } });
})

// ========================
// DELETE PRODUCT
// ========================
const deleteProduct = asyncWrapper(async (req, res, next) => {
    const product = await Product.findById(req.params.id).populate(
        'userId',
        'firstName lastName email'
    );

    if (!product) {
        const error = appError.create('product not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    const ownerId =
        product.userId && product.userId._id
            ? product.userId._id.toString()
            : String(product.userId);

    if (ownerId !== req.currentUser.id && req.currentUser.role !== 'ADMIN') {
        const error = appError.create('you are not authorized to delete this product', 403, httpStatusText.FAIL);
        return next(error);
    }

    const {
        sendListingRejectedEmail,
    } = require('../services/listingEmail.service');
    let emailResult = null;
    const isAdminRejectingPending =
        req.currentUser.role === 'ADMIN' &&
        ownerId !== req.currentUser.id &&
        !product.isApproved;

    if (isAdminRejectingPending) {
        try {
            emailResult = await sendListingRejectedEmail(product);
        } catch (err) {
            console.error('[listing-email] reject:', err.message);
            emailResult = { sent: false, error: err.message };
        }
    }

    await ProductImage.deleteMany({ productId: req.params.id });
    await Product.findByIdAndDelete(req.params.id);

    res.json({
        status: httpStatusText.SUCCESS,
        data: { email: emailResult },
    });
})

// ========================
// APPROVE PRODUCT (ADMIN)
// ========================
const approveProduct = asyncWrapper(async (req, res, next) => {
    if (req.currentUser.role !== 'ADMIN') {
        const error = appError.create('you are not authorized', 403, httpStatusText.FAIL);
        return next(error);
    }

    const product = await Product.findByIdAndUpdate(
        req.params.id,
        { $set: { isApproved: true, status: 'available' } },
        { new: true }
    ).populate('userId', 'firstName lastName email');

    if (!product) {
        const error = appError.create('product not found', 404, httpStatusText.FAIL);
        return next(error);
    }

    const { sendListingApprovedEmail } = require('../services/listingEmail.service');
    let emailResult = null;
    try {
        emailResult = await sendListingApprovedEmail(product);
    } catch (err) {
        console.error('[listing-email] approve:', err.message);
        emailResult = { sent: false, error: err.message };
    }

    res.json({
        status: httpStatusText.SUCCESS,
        data: { product, email: emailResult },
    });
})

// ========================
// PENDING LISTINGS (ADMIN)
// ========================
const getAdminPendingProducts = asyncWrapper(async (req, res, next) => {
    if (req.currentUser.role !== 'ADMIN') {
        const error = appError.create('you are not authorized', 403, httpStatusText.FAIL);
        return next(error);
    }

    const products = await Product.find({ isApproved: false })
        .sort({ createdAt: -1 })
        .populate('userId', 'firstName lastName email')
        .populate({
            path: 'categoryId',
            populate: { path: 'parentId', select: 'categoryName categoryId' },
        });

    const productsWithImages = await Promise.all(
        products.map(async (product) => {
            const images = await ProductImage.find({ productId: product._id }, { __v: false });
            return { ...product.toObject(), images };
        })
    );

    res.json({ status: httpStatusText.SUCCESS, data: { products: productsWithImages } });
})

// ========================
// AI PRICE SUGGESTION
// ========================
const suggestProductPrice = asyncWrapper(async (req, res, next) => {
    const brand = typeof req.body.brand === 'string' ? req.body.brand.trim() : '';
    const productName =
        typeof req.body.productName === 'string'
            ? req.body.productName.trim()
            : typeof req.body.name === 'string'
              ? req.body.name.trim()
              : '';
    const material = typeof req.body.material === 'string' ? req.body.material.trim() : '';
    const condition = normalizeCondition(req.body.condition);

    if (!brand || !productName || !material || !condition) {
        return next(
            appError.create(
                'brand, productName (or name), material, and condition (new or used) are required',
                400,
                httpStatusText.FAIL
            )
        );
    }

    let suggestion;
    try {
        suggestion = await suggestPriceRange({
            brand,
            productName,
            material,
            condition,
            currency:
                typeof req.body.currency === 'string' && req.body.currency.trim()
                    ? req.body.currency.trim().toUpperCase()
                    : undefined,
        });
    } catch (e) {
        return handleGroqSuggestError(e, next);
    }

    res.json({ status: httpStatusText.SUCCESS, data: { suggestion } });
})

// Save AI suggestion on an existing product (owner or admin). Optionally updates listed price.
const applyPriceSuggestionToProduct = asyncWrapper(async (req, res, next) => {
    const id = req.params.id;
    if (!mongoose.isValidObjectId(String(id).trim())) {
        return next(appError.create('invalid product id', 400, httpStatusText.FAIL));
    }

    const product = await Product.findById(String(id).trim());
    if (!product) {
        return next(appError.create('product not found', 404, httpStatusText.FAIL));
    }
    if (product.userId.toString() !== req.currentUser.id && req.currentUser.role !== 'ADMIN') {
        return next(appError.create('you are not authorized', 403, httpStatusText.FAIL));
    }

    const updateListedPrice = req.body.updateListedPrice !== false;
    const productName = productNameForAi(product, req.body.productName);
    if (!productName) {
        return next(
            appError.create(
                'no product title: add a description to the product or send productName in the body',
                400,
                httpStatusText.FAIL
            )
        );
    }

    let suggestion;
    try {
        suggestion = await suggestPriceRange({
            brand: product.brand,
            productName,
            material: product.material,
            condition: product.condition,
            currency:
                typeof req.body.currency === 'string' && req.body.currency.trim()
                    ? req.body.currency.trim().toUpperCase()
                    : undefined,
        });
    } catch (e) {
        return handleGroqSuggestError(e, next);
    }

    const priceSuggestion = buildPriceSuggestionDoc(suggestion);
    const patch = { priceSuggestion };
    if (updateListedPrice) {
        patch.price = listedPriceFromSuggestion(suggestion);
    }

    const updated = await Product.findByIdAndUpdate(product._id, { $set: patch }, { new: true }).populate({
        path: 'categoryId',
        populate: { path: 'parentId', select: 'categoryName categoryId' },
    });

    res.json({
        status: httpStatusText.SUCCESS,
        data: {
            product: updated,
            appliedListedPrice: updateListedPrice,
            suggestion,
        },
    });
})

// Admin: run suggestion on many products (paginated). Saves priceSuggestion; can sync listed price.
const bulkApplyPriceSuggestions = asyncWrapper(async (req, res, next) => {
    if (!process.env.GROQ_API_KEY) {
        return next(
            appError.create('AI price suggestion is not configured (set GROQ_API_KEY)', 503, httpStatusText.ERROR)
        );
    }

    const q = { ...req.query, ...req.body };
    const limit = Math.min(Math.max(Number(q.limit) || 25, 1), 100);
    const skip = Math.max(Number(q.skip) || 0, 0);
    const delayMs = Math.min(Math.max(Number(q.delayMs) || 400, 0), 5000);
    const updateListedPrice = q.updateListedPrice !== false && q.updateListedPrice !== 'false';

    const products = await Product.find({})
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .select('description brand material condition price userId');

    const ok = [];
    const failed = [];

    for (const product of products) {
        const productName = productNameForAi(product, null);
        if (!productName) {
            failed.push({ id: product._id.toString(), message: 'missing description' });
            continue;
        }
        try {
            const suggestion = await suggestPriceRange({
                brand: product.brand,
                productName,
                material: product.material,
                condition: product.condition,
                currency:
                    typeof q.currency === 'string' && q.currency.trim()
                        ? q.currency.trim().toUpperCase()
                        : undefined,
            });
            const priceSuggestion = buildPriceSuggestionDoc(suggestion);
            const patch = { priceSuggestion };
            if (updateListedPrice) {
                patch.price = listedPriceFromSuggestion(suggestion);
            }
            await Product.updateOne({ _id: product._id }, { $set: patch });
            ok.push(product._id.toString());
        } catch (e) {
            failed.push({
                id: product._id.toString(),
                message: e.message || String(e),
                code: e.code,
            });
        }
        if (delayMs > 0) {
            await delay(delayMs);
        }
    }

    res.json({
        status: httpStatusText.SUCCESS,
        data: {
            limit,
            skip,
            processed: products.length,
            updatedIds: ok,
            failed,
        },
    });
})

module.exports = {
    getAllProducts,
    getProduct,
    addProduct,
    updateProduct,
    deleteProduct,
    approveProduct,
    getAdminPendingProducts,
    suggestProductPrice,
    applyPriceSuggestionToProduct,
    bulkApplyPriceSuggestions,
}