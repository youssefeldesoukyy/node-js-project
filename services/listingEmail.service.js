const User = require('../models/user.model');
const { sendEmail } = require('../utils/sendEmail');

function sellerName(user) {
    if (!user) return 'there';
    const combined = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return combined || 'there';
}

function listingTitle(product) {
    if (!product) return 'Your listing';
    return (
        [product.brand, product.description].filter(Boolean).join(' — ') ||
        product.name ||
        'Your listing'
    );
}

function shopBaseUrl() {
    return String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

/**
 * Notify seller their listing was approved and is live on the shop.
 * @param {import('mongoose').Document} product — populate userId recommended
 */
async function sendListingApprovedEmail(product) {
    if (!product) return { sent: false, reason: 'no_product' };

    let seller =
        product.userId && typeof product.userId === 'object' && product.userId.email
            ? product.userId
            : null;
    if (!seller) {
        seller = await User.findById(product.userId).select('firstName lastName email');
    }
    if (!seller || !seller.email) {
        console.warn('[listing-email] No seller email for product', product._id);
        return { sent: false, reason: 'no_email' };
    }

    const appName = process.env.APP_NAME || 'Thrift It';
    const title = listingTitle(product);
    const shopUrl = `${shopBaseUrl()}/shopall.html`;

    const result = await sendEmail({
        to: seller.email,
        subject: `${appName} — your listing was approved`,
        text:
            `Hi ${sellerName(seller)},\n\n` +
            `Good news — your listing "${title}" has been approved and is now live on ${appName}.\n\n` +
            `Shoppers can find it here:\n${shopUrl}\n\n` +
            `Thank you for selling with us.\n\n— ${appName}`,
        html:
            `<div style="font-family:Poppins,Arial,sans-serif;max-width:560px;color:#222;">` +
            `<h2 style="margin:0 0 8px;">Listing approved</h2>` +
            `<p>Hi ${sellerName(seller)},</p>` +
            `<p>Your listing <strong>${title}</strong> is now <strong>live</strong> on ${appName}.</p>` +
            `<p><a href="${shopUrl}">View the shop</a></p>` +
            `<p>Thank you for selling with us.</p>` +
            `<p>— ${appName}</p></div>`,
    });

    return {
        sent: !!result.delivered,
        logged: !!result.logged,
        provider: result.provider || null,
    };
}

/**
 * Notify seller their listing was rejected (admin).
 * @param {import('mongoose').Document} product — populate userId before delete
 */
async function sendListingRejectedEmail(product) {
    if (!product) return { sent: false, reason: 'no_product' };

    let seller =
        product.userId && typeof product.userId === 'object' && product.userId.email
            ? product.userId
            : null;
    if (!seller) {
        seller = await User.findById(product.userId).select('firstName lastName email');
    }
    if (!seller || !seller.email) {
        console.warn('[listing-email] No seller email for rejected product', product._id);
        return { sent: false, reason: 'no_email' };
    }

    const appName = process.env.APP_NAME || 'Thrift It';
    const title = listingTitle(product);
    const sellUrl = `${shopBaseUrl()}/seller.html`;

    const result = await sendEmail({
        to: seller.email,
        subject: `${appName} — update on your listing`,
        text:
            `Hi ${sellerName(seller)},\n\n` +
            `Thank you for submitting "${title}" on ${appName}.\n\n` +
            `After review, we are unable to approve this listing at this time. ` +
            `You can submit a new listing that meets our guidelines:\n${sellUrl}\n\n` +
            `— ${appName}`,
        html:
            `<div style="font-family:Poppins,Arial,sans-serif;max-width:560px;color:#222;">` +
            `<h2 style="margin:0 0 8px;">Listing not approved</h2>` +
            `<p>Hi ${sellerName(seller)},</p>` +
            `<p>Thank you for submitting <strong>${title}</strong>.</p>` +
            `<p>After review, we are unable to approve this listing at this time. ` +
            `You may <a href="${sellUrl}">list another item</a> that meets our guidelines.</p>` +
            `<p>— ${appName}</p></div>`,
    });

    return {
        sent: !!result.delivered,
        logged: !!result.logged,
        provider: result.provider || null,
    };
}

module.exports = {
    sendListingApprovedEmail,
    sendListingRejectedEmail,
};
