const nodemailer = require('nodemailer');

function isPlaceholderSmtpValue(value) {
    const s = String(value || '').toLowerCase();
    return (
        !s ||
        /your-email|your-app-password|your-address|changeme|example\.com|placeholder|paste-app-password/.test(s)
    );
}

function isResendConfigured() {
    const key = process.env.RESEND_API_KEY || '';
    return key.length > 10 && !/^re_xxx|your-resend/i.test(key);
}

function isEmailConfigured() {
    return !!(
        process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        !isPlaceholderSmtpValue(process.env.SMTP_USER) &&
        !isPlaceholderSmtpValue(process.env.SMTP_PASS)
    );
}

function isDevEmailLogMode() {
    return (
        process.env.SMTP_DEV_LOG_ONLY === 'true' ||
        (!isResendConfigured() && !isEmailConfigured())
    );
}

function createTransport() {
    if (!isEmailConfigured()) return null;
    const port = Number(process.env.SMTP_PORT) || 587;
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

async function sendViaResend(opts, from) {
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from,
            to: [opts.to],
            subject: opts.subject,
            html: opts.html || opts.text.replace(/\n/g, '<br>'),
            text: opts.text,
        }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Resend HTTP ${res.status}`);
    }
    const data = await res.json();
    return data;
}

/**
 * @param {{ to: string, subject: string, text: string, html?: string }} opts
 */
async function sendEmail(opts) {
    const smtpFrom =
        process.env.SMTP_FROM ||
        process.env.SMTP_USER ||
        'noreply@thriftit.local';
    const resendFrom =
        process.env.RESEND_FROM || 'onboarding@resend.dev';

    if (isResendConfigured()) {
        try {
            const data = await sendViaResend(opts, resendFrom);
            console.log('[email] Sent via Resend to', opts.to, data.id ? `(${data.id})` : '');
            return { delivered: true, provider: 'resend' };
        } catch (err) {
            let detail = err.message;
            try {
                const parsed = JSON.parse(err.message);
                detail = parsed.message || detail;
                if (/only send.*your own email|testing/i.test(detail)) {
                    console.error(
                        '[email] Resend testing mode: send forgot-password to the email you used to sign up at resend.com, or verify a domain.'
                    );
                }
            } catch (_) {
                /* not JSON */
            }
            console.error('[email] Resend failed:', detail);
            throw new Error(detail);
        }
    }

    if (!isEmailConfigured() || process.env.SMTP_DEV_LOG_ONLY === 'true') {
        console.warn('[email] No mail provider — logged to terminal only.');
        console.warn('[email] To:', opts.to);
        console.warn('[email] Subject:', opts.subject);
        console.warn('[email] Body:\n', opts.text);
        return { delivered: false, logged: true, devMode: true };
    }

    const transport = createTransport();
    try {
        const info = await transport.sendMail({
            from: smtpFrom,
            to: opts.to,
            subject: opts.subject,
            text: opts.text,
            html: opts.html || opts.text.replace(/\n/g, '<br>'),
        });
        console.log('[email] Sent via SMTP to', opts.to, info.messageId ? `(${info.messageId})` : '');
        return { delivered: true, provider: 'smtp' };
    } catch (err) {
        console.error('[email] SMTP send failed:', err.message);
        if (/basic authentication is disabled|5\.7\.139/i.test(err.message)) {
            console.error(
                '[email] Hotmail/Outlook no longer allows app-password SMTP. ' +
                    'Use Resend: sign up at https://resend.com, add RESEND_API_KEY to .env'
            );
        }
        throw err;
    }
}

module.exports = { sendEmail, isEmailConfigured, isDevEmailLogMode, isResendConfigured };
