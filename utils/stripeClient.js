const Stripe = require('stripe');

let stripe;

/**
 * @returns {Stripe | null} null if STRIPE_SECRET_KEY is not set (cash-only mode).
 */
function getStripe() {
    if (stripe) return stripe;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || !key.startsWith('sk_')) {
        return null;
    }
    stripe = new Stripe(key);
    return stripe;
}

function isStripeEnabled() {
    return getStripe() !== null;
}

/** Smallest currency unit (e.g. cents). Order.amount is in main unit (e.g. 10.50). */
function amountToStripeUnit(mainUnit) {
    const n = Number(mainUnit);
    if (Number.isNaN(n) || n < 0) return 0;
    return Math.round(n * 100);
}

module.exports = { getStripe, isStripeEnabled, amountToStripeUnit };
