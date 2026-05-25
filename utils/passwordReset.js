const crypto = require('crypto');

function generateResetToken() {
    return crypto.randomBytes(32).toString('hex');
}

function hashResetToken(rawToken) {
    return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
}

function getFrontendBaseUrl() {
    const raw = process.env.FRONTEND_URL || 'http://localhost:5173';
    const first = String(raw).split(',')[0].trim();
    return first.replace(/\/$/, '');
}

function buildPasswordResetLink(rawToken) {
    return `${getFrontendBaseUrl()}/reset-password.html?token=${encodeURIComponent(rawToken)}`;
}

module.exports = {
    generateResetToken,
    hashResetToken,
    getFrontendBaseUrl,
    buildPasswordResetLink,
};
