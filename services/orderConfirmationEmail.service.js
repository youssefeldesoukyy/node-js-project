const Order = require('../models/order.model');
const { sendEmail } = require('../utils/sendEmail');

function formatMoney(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n)) return '0';
    return `${n.toLocaleString('en-EG')} EGP`;
}

function buildLineItemsHtml(products) {
    if (!products.length) {
        return '<p><em>No line items</em></p>';
    }
    const rows = products
        .map((item) => {
            const p = item.productId;
            if (!p) return '';
            const qty = item.quantity || 1;
            const lineTotal = (p.price || 0) * qty;
            const title = [p.brand, p.description].filter(Boolean).join(' — ') || 'Item';
            return (
                `<tr>` +
                `<td style="padding:8px 0;border-bottom:1px solid #eee;">${title}<br>` +
                `<small style="color:#666;">Size ${p.size || '—'} · Qty ${qty}</small></td>` +
                `<td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${formatMoney(lineTotal)}</td>` +
                `</tr>`
            );
        })
        .join('');
    return (
        `<table style="width:100%;border-collapse:collapse;">` +
        `<thead><tr>` +
        `<th style="text-align:left;padding-bottom:8px;">Item</th>` +
        `<th style="text-align:right;padding-bottom:8px;">Price</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>`
    );
}

function buildLineItemsText(products) {
    return products
        .map((item) => {
            const p = item.productId;
            if (!p) return '';
            const qty = item.quantity || 1;
            const title = [p.brand, p.description].filter(Boolean).join(' — ') || 'Item';
            return `  - ${title} (size ${p.size || '—'}, qty ${qty}) — ${formatMoney((p.price || 0) * qty)}`;
        })
        .filter(Boolean)
        .join('\n');
}

/**
 * Send order confirmation once per order (idempotent).
 * @param {string|import('mongoose').Types.ObjectId} orderId
 * @param {{ paymentLabel?: string }} [opts]
 */
async function sendOrderConfirmationIfNeeded(orderId, opts = {}) {
    const order = await Order.findById(orderId)
        .populate('userId', 'firstName lastName email')
        .populate('products.productId', 'brand description price size');

    if (!order) {
        console.warn('[order-email] Order not found:', orderId);
        return { sent: false, reason: 'order_not_found' };
    }

    if (order.confirmationEmailSentAt) {
        return { sent: false, reason: 'already_sent' };
    }

    const user = order.userId;
    if (!user || !user.email) {
        console.warn('[order-email] No customer email for order', order._id);
        return { sent: false, reason: 'no_email' };
    }

    const appName = process.env.APP_NAME || 'Thrift It';
    const orderIdShort = String(order._id).slice(-8).toUpperCase();
    const statusLabel =
        order.status === 'confirmed'
            ? 'Approved — processing'
            : order.status === 'pending'
              ? 'Received — awaiting admin approval'
              : order.status === 'shipped'
                ? 'Shipped'
                : order.status === 'cancelled'
                  ? 'Cancelled'
                  : order.status;
    const paymentLabel = opts.paymentLabel || 'See your receipt';
    const placedAt = order.createdAt
        ? new Date(order.createdAt).toLocaleString('en-EG', { dateStyle: 'medium', timeStyle: 'short' })
        : new Date().toLocaleString();

    const lines = order.products || [];
    const subject = `${appName} — order confirmation #${orderIdShort}`;

    const text =
        `Hi ${user.firstName || 'there'},\n\n` +
        `Thank you for your purchase!\n\n` +
        `Order #${orderIdShort}\n` +
        `Status: ${statusLabel}\n` +
        `Payment: ${paymentLabel}\n` +
        `Placed: ${placedAt}\n\n` +
        `Delivery address:\n${order.address}\n\n` +
        `Items:\n${buildLineItemsText(lines) || '  (none)'}\n\n` +
        `Total: ${formatMoney(order.amount)}\n\n` +
        `We'll keep you updated on your order.\n\n` +
        `— ${appName}`;

    const html =
        `<div style="font-family:Poppins,Arial,sans-serif;max-width:560px;color:#222;">` +
        `<h2 style="margin:0 0 8px;">Thank you for your order!</h2>` +
        `<p>Hi ${user.firstName || 'there'},</p>` +
        `<p>We've received your order <strong>#${orderIdShort}</strong>.</p>` +
        `<table style="margin:16px 0;font-size:14px;">` +
        `<tr><td style="padding:4px 12px 4px 0;color:#666;">Status</td><td><strong>${statusLabel}</strong></td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#666;">Payment</td><td>${paymentLabel}</td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#666;">Placed</td><td>${placedAt}</td></tr>` +
        `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;">Address</td><td>${order.address}</td></tr>` +
        `</table>` +
        `<h3 style="margin:24px 0 8px;font-size:16px;">Items</h3>` +
        buildLineItemsHtml(lines) +
        `<p style="margin:24px 0 8px;font-size:18px;"><strong>Total: ${formatMoney(order.amount)}</strong></p>` +
        `<p style="color:#666;font-size:13px;">${
            order.status === 'pending'
                ? 'Your order is waiting for admin approval. We will email you when it is approved.'
                : "We'll keep you updated on your order."
        }</p>` +
        `<p>— ${appName}</p>` +
        `</div>`;

    try {
        const result = await sendEmail({
            to: user.email,
            subject,
            text,
            html,
        });

        if (result.delivered || result.logged) {
            await Order.findByIdAndUpdate(order._id, {
                $set: { confirmationEmailSentAt: new Date() },
            });
        }

        if (result.logged && !result.delivered) {
            console.log('[order-email] Dev mode — confirmation logged for order', orderIdShort);
        }

        return { sent: !!result.delivered, logged: !!result.logged };
    } catch (err) {
        console.error('[order-email] Failed for order', orderIdShort, err.message);
        throw err;
    }
}

module.exports = { sendOrderConfirmationIfNeeded };
