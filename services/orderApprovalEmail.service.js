const Order = require('../models/order.model');
const { sendEmail } = require('../utils/sendEmail');

function formatMoney(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '0';
    return `${n.toLocaleString('en-EG')} EGP`;
}

function orderIdShort(order) {
    return String(order._id).slice(-8).toUpperCase();
}

function buyerName(user) {
    if (!user) return 'there';
    const combined = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return combined || 'there';
}

async function loadOrderForEmail(orderId) {
    return Order.findById(orderId)
        .populate('userId', 'firstName lastName email')
        .populate({
            path: 'products.productId',
            select: 'brand description price size userId',
            populate: { path: 'userId', select: 'firstName lastName email' },
        });
}

function uniqueSellersFromOrder(order) {
    const map = new Map();
    for (const line of order.products || []) {
        const product = line.productId;
        if (!product || typeof product !== 'object') continue;
        const seller = product.userId;
        if (!seller || typeof seller !== 'object' || !seller.email) continue;
        const id = String(seller._id);
        if (!map.has(id)) {
            map.set(id, seller);
        }
    }
    return [...map.values()];
}

function itemsText(order) {
    return (order.products || [])
        .map((line) => {
            const p = line.productId;
            if (!p || typeof p !== 'object') return '';
            const title = [p.brand, p.description].filter(Boolean).join(' — ') || 'Item';
            return `  - ${title} (${formatMoney((p.price || 0) * (line.quantity || 1))})`;
        })
        .filter(Boolean)
        .join('\n');
}

/**
 * Notify buyer + sellers after admin approves a pending order.
 */
async function sendOrderApprovedEmails(orderId) {
    const order = await loadOrderForEmail(orderId);
    if (!order) return;

    const appName = process.env.APP_NAME || 'Thrift It';
    const shortId = orderIdShort(order);
    const buyer = order.userId;

    if (buyer && buyer.email) {
        await sendEmail({
            to: buyer.email,
            subject: `${appName} — your order #${shortId} was confirmed`,
            text:
                `Hi ${buyerName(buyer)},\n\n` +
                `Your order #${shortId} is confirmed.\n\n` +
                `Total: ${formatMoney(order.amount)}\n` +
                `Delivery address:\n${order.address}\n\n` +
                `Items:\n${itemsText(order) || '  (see your account)'}\n\n` +
                `— ${appName}`,
            html:
                `<p>Hi ${buyerName(buyer)},</p>` +
                `<p>Your order <strong>#${shortId}</strong> is confirmed.</p>` +
                `<p><strong>Total:</strong> ${formatMoney(order.amount)}</p>` +
                `<p>— ${appName}</p>`,
        }).catch((err) => console.error('[order-email] approve buyer:', err.message));
    }

    const sellers = uniqueSellersFromOrder(order);
    for (const seller of sellers) {
        await sendEmail({
            to: seller.email,
            subject: `${appName} — new sale on order #${shortId}`,
            text:
                `Hi ${buyerName(seller)},\n\n` +
                `An order including your listing(s) was approved (#${shortId}).\n` +
                `Please prepare the item(s) for shipping.\n\n— ${appName}`,
            html:
                `<p>Hi ${buyerName(seller)},</p>` +
                `<p>Order <strong>#${shortId}</strong> including your listing(s) was approved. Please prepare the item(s) for shipping.</p>` +
                `<p>— ${appName}</p>`,
        }).catch((err) => console.error('[order-email] approve seller:', err.message));
    }
}

/**
 * Notify buyer + sellers after admin rejects a pending order.
 */
async function sendOrderRejectedEmails(orderId) {
    const order = await loadOrderForEmail(orderId);
    if (!order) return;

    const appName = process.env.APP_NAME || 'Thrift It';
    const shortId = orderIdShort(order);
    const buyer = order.userId;

    if (buyer && buyer.email) {
        await sendEmail({
            to: buyer.email,
            subject: `${appName} — order #${shortId} was not approved`,
            text:
                `Hi ${buyerName(buyer)},\n\n` +
                `We're sorry — your order #${shortId} could not be approved at this time.\n` +
                `If payment was taken, our team will follow up regarding any refund.\n\n` +
                `— ${appName}`,
            html:
                `<p>Hi ${buyerName(buyer)},</p>` +
                `<p>Your order <strong>#${shortId}</strong> could not be approved. If you were charged, we will contact you about a refund.</p>` +
                `<p>— ${appName}</p>`,
        }).catch((err) => console.error('[order-email] reject buyer:', err.message));
    }

    const sellers = uniqueSellersFromOrder(order);
    for (const seller of sellers) {
        await sendEmail({
            to: seller.email,
            subject: `${appName} — order #${shortId} was cancelled`,
            text:
                `Hi ${buyerName(seller)},\n\n` +
                `Order #${shortId} involving your listing(s) was not approved and has been cancelled.\n\n` +
                `— ${appName}`,
            html:
                `<p>Hi ${buyerName(seller)},</p>` +
                `<p>Order <strong>#${shortId}</strong> was not approved. Your listing(s) remain available on the shop.</p>` +
                `<p>— ${appName}</p>`,
        }).catch((err) => console.error('[order-email] reject seller:', err.message));
    }
}

/**
 * Notify buyer when admin marks order as shipped (reviews unlock).
 */
async function sendOrderShippedEmails(orderId) {
    const order = await loadOrderForEmail(orderId);
    if (!order) return;

    const appName = process.env.APP_NAME || 'Thrift It';
    const shortId = orderIdShort(order);
    const buyer = order.userId;

    if (!buyer || !buyer.email) return;

    await sendEmail({
        to: buyer.email,
        subject: `${appName} — order #${shortId} has shipped`,
        text:
            `Hi ${buyerName(buyer)},\n\n` +
            `Your order #${shortId} has been shipped!\n` +
            `You can leave a seller review from your profile once you receive your items.\n\n` +
            `— ${appName}`,
        html:
            `<p>Hi ${buyerName(buyer)},</p>` +
            `<p>Your order <strong>#${shortId}</strong> has been <strong>shipped</strong>.</p>` +
            `<p>You can rate your seller from your profile after delivery.</p>` +
            `<p>— ${appName}</p>`,
    }).catch((err) => console.error('[order-email] shipped:', err.message));
}

module.exports = {
    sendOrderApprovedEmails,
    sendOrderRejectedEmails,
    sendOrderShippedEmails,
};
