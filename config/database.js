const dns = require('dns');
const mongoose = require('mongoose');

// Some Windows/ISP DNS resolvers refuse SRV lookups for mongodb+srv://
if (process.env.MONGO_DNS_SERVERS) {
    dns.setServers(process.env.MONGO_DNS_SERVERS.split(',').map((s) => s.trim()).filter(Boolean));
} else if (process.env.NODE_ENV !== 'production') {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
}

let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

/** Race `promise` against a wall-clock timeout so callers get a rejection instead of hanging. */
function withTimeout(promise, ms, timeoutMessage) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(timeoutMessage));
        }, ms);

        promise
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((err) => {
                clearTimeout(timer);
                reject(err);
            });
    });
}

async function resetMongooseState(abandonedPromise) {
    if (abandonedPromise && typeof abandonedPromise.then === 'function') {
        abandonedPromise.catch(() => {});
    }
    cached.promise = null;
    cached.conn = null;
    try {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
    } catch (_) {
        // best-effort after failed or timed-out connect
    }
}

/** Host part of the URI for logs only (no user/password). */
function mongoTargetForLog(url) {
    if (!url || typeof url !== 'string') return '(missing)';
    const match =
        url.match(/mongodb\+srv:\/\/(?:[^@]*@)?([^/?]+)/) ||
        url.match(/mongodb:\/\/(?:[^@]*@)?([^/?]+)/);
    return match ? match[1] : '(unparsed uri)';
}

async function connectDB() {
    const url = process.env.MONGO_URL_YWAELE || process.env.MONGO_URL;
    if (!url) {
        throw new Error('MONGO_URL_YWAELE or MONGO_URL is not defined');
    }

    if (cached.conn && mongoose.connection.readyState === 1) {
        return cached.conn;
    }

    const mongoLabel = mongoTargetForLog(url);

    const defaultOverallMs = 20000;
    const overallMs = Number(process.env.MONGO_CONNECT_TIMEOUT_MS) || defaultOverallMs;

    const timeoutMessage = `MongoDB connect exceeded ${overallMs}ms. Check Atlas URI, network access, and that the cluster is reachable. Override with MONGO_CONNECT_TIMEOUT_MS.`;

    const mongooseOpts = {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 12000,
        socketTimeoutMS: 0,
        maxPoolSize: 5,
    };

    if (!cached.promise) {
        console.log('[mongo] connecting —', mongoLabel);
        cached.promise = mongoose.connect(url, mongooseOpts).then(async (m) => {
            const c = mongoose.connection;
            console.log(
                '[mongo] connected OK —',
                `host=${c.host}`,
                `db=${c.name}`,
                `readyState=${c.readyState}`,
                '(connected)'
            );
            try {
                const Category = require('../models/category.model');
                await Category.syncIndexes();
                const ensureCatalogCategories = require('../utils/ensureCatalogCategories');
                await ensureCatalogCategories();
            } catch (e) {
                console.warn('Category index sync:', e.message);
            }
            return m;
        });
    }

    const pending = cached.promise;
    try {
        await withTimeout(pending, overallMs, timeoutMessage);
        const ready = mongoose.connection.readyState === 1;
        if (!ready) {
            await resetMongooseState(pending);
            throw new Error('MongoDB connection did not become ready after connect promise resolved.');
        }
        cached.conn = mongoose.connection;
        return cached.conn;
    } catch (e) {
        console.error('[mongo] connection failed —', mongoLabel, '—', e.message);
        await resetMongooseState(pending);
        throw e;
    }
}

module.exports = connectDB;
