const ROOT_CATEGORY_NAMES = ['Men', 'Women'];

/** Allowed subcategories under Men / Women (stored lowercase). */
const ALLOWED_SUBCATEGORIES = [
    'jackets',
    'shirts',
    'tshirts',
    'tops',
    'accessories',
    'dresses',
    'bottoms',
    'sweatshirts',
];

/** Legacy slugs from older listings → current catalog name. */
const SUBCATEGORY_ALIASES = {
    pants: 'bottoms',
    sweatshirt: 'sweatshirts',
    skirt: 'bottoms',
    skirts: 'bottoms',
    shoes: 'accessories',
    shoe: 'accessories',
    bags: 'accessories',
    bag: 'accessories',
};

function canonicalSubcategoryName(name) {
    if (!name || typeof name !== 'string') return '';
    const s = name.trim().toLowerCase();
    return SUBCATEGORY_ALIASES[s] || s;
}

module.exports = {
    ROOT_CATEGORY_NAMES,
    ALLOWED_SUBCATEGORIES,
    SUBCATEGORY_ALIASES,
    canonicalSubcategoryName,
};
