const CLOTHING_SIZES = ['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl'];

const SHOE_MIN = 36;
const SHOE_MAX = 48;

const JEANS_WAIST_MIN = 24;
const JEANS_WAIST_MAX = 48;

/**
 * @param {string|number} sizeInput - raw from client
 * @param {string} subcategoryName - leaf category `categoryName` (e.g. "tshirts", "bottoms")
 * @returns {{ ok: true, value: string } | { ok: false, message: string }}
 */
function parseAndValidateSize(sizeInput, subcategoryName) {
    const sub = (subcategoryName || '').toLowerCase();

    if (sub === 'accessories') {
        const s = String(sizeInput).trim().toLowerCase();
        if (s === 'm' || s === 'one size' || s === 'onesize') {
            return { ok: true, value: 'm' };
        }
        return {
            ok: false,
            message: 'accessories size must be m (one size)'
        };
    }

    if (sub === 'shoes') {
        const n = parseInt(String(sizeInput).trim(), 10);
        if (!Number.isInteger(n) || n < SHOE_MIN || n > SHOE_MAX) {
            return {
                ok: false,
                message: `shoe size must be a whole number between ${SHOE_MIN} and ${SHOE_MAX}`
            };
        }
        return { ok: true, value: String(n) };
    }

    if (sub === 'bottoms') {
        const n = parseInt(String(sizeInput).trim(), 10);
        if (
            Number.isInteger(n) &&
            n >= JEANS_WAIST_MIN &&
            n <= JEANS_WAIST_MAX &&
            n % 2 === 0
        ) {
            return { ok: true, value: String(n) };
        }
        const s = String(sizeInput).trim().toLowerCase();
        if (CLOTHING_SIZES.includes(s)) {
            return { ok: true, value: s };
        }
        return {
            ok: false,
            message: `bottoms size must be ${CLOTHING_SIZES.join(', ')} or a jeans waist (${JEANS_WAIST_MIN}–${JEANS_WAIST_MAX}, even numbers)`
        };
    }

    const s = String(sizeInput).trim().toLowerCase();
    if (!CLOTHING_SIZES.includes(s)) {
        return {
            ok: false,
            message: `size must be one of: ${CLOTHING_SIZES.join(', ')} (for non-shoe categories)`
        };
    }
    return { ok: true, value: s };
}

module.exports = {
    CLOTHING_SIZES,
    SHOE_MIN,
    SHOE_MAX,
    JEANS_WAIST_MIN,
    JEANS_WAIST_MAX,
    parseAndValidateSize
};
