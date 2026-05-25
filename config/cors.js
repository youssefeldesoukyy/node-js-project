/**
 * Explicit CORS for browsers.
 * FRONTEND_URL: comma-separated origins.
 */
function normalizeOrigin(o) {
    if (!o || typeof o !== 'string') return '';
    return o.trim().replace(/\/+$/, '');
}

/** Lets `fetch` from opened HTML via file:///... (browser sends Origin: null). Never enable on public production without understanding the risk. */
function allowLocalFileOpening() {
    return process.env.ALLOW_FILE_ORIGIN_CORS === 'true';
}

function parseAllowedOrigins() {
    const raw = process.env.FRONTEND_URL || '';
    const fromEnv = raw
        .split(',')
        .map((s) => normalizeOrigin(s))
        .filter(Boolean);
    const local = [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:4000',
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:4000',
        'http://127.0.0.1:4000',
    ];
    return [...new Set([...fromEnv, ...local])];
}

function isOriginAllowed(origin, allowedList) {
    if (!origin) return false;
    const n = normalizeOrigin(origin);
    if (n === 'null' && allowLocalFileOpening()) return true;
    if (allowedList.includes(n)) return true;
    return false;
}

function applyCorsHeaders(req, res) {
    const allowed = parseAllowedOrigins();
    const origin = req.headers.origin;

    if (origin && isOriginAllowed(origin, allowed)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        // Browsers reject Origin "null" (file://) combined with Allow-Credentials: true
        if (normalizeOrigin(origin) !== 'null') {
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        res.setHeader(
            'Access-Control-Allow-Methods',
            'GET, POST, PUT, PATCH, DELETE, OPTIONS'
        );
        res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, Authorization, X-Requested-With'
        );
        res.setHeader('Vary', 'Origin');
    }
    // Chrome: localhost:5173 → localhost:4000 may require private-network access
    if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
}

function corsMiddleware(req, res, next) {
    applyCorsHeaders(req, res);
    next();
}

/** Options for the `cors` npm package — use before all routes in app.js */
function getCorsPackageOptions() {
    const allowedList = parseAllowedOrigins();
    return {
        origin(origin, callback) {
            if (!origin) {
                return callback(null, true);
            }
            if (origin === 'null' && allowLocalFileOpening()) {
                return callback(null, 'null');
            }
            if (isOriginAllowed(origin, allowedList)) {
                return callback(null, true);
            }
            return callback(null, false);
        },
        // Bearer tokens in Authorization — not cookies. false avoids file:// CORS blocks.
        credentials: false,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    };
}

corsMiddleware.applyCorsHeaders = applyCorsHeaders;
corsMiddleware.getCorsPackageOptions = getCorsPackageOptions;
module.exports = corsMiddleware;
