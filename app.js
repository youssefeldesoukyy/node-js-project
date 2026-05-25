const express = require('express');

const path = require('path');

const cors = require('cors');

const mongoose = require('mongoose');



const connectDB = require('./config/database');

const corsMiddleware = require('./config/cors');

const getApiRouter = require('./api-bundle');



const app = express();

// Same allowlist as config/cors.js: FRONTEND_URL and localhost dev origins.

const corsOptions = corsMiddleware.getCorsPackageOptions();



app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network'] === 'true') {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    next();
});

app.use(cors(corsOptions));

app.options('*', cors(corsOptions));

/** No Mongo — quick check for frontend on :5173 */
app.get('/api/ping', (req, res) => {
    res.status(200).json({ ok: true, api: true });
});



/** Works without Mongo — quick liveness check. */

app.get('/health', (req, res) => {

    res.status(200).json({ ok: true, service: 'api', uptime: process.uptime() });

});

app.get('/db-test', async (req, res) => {
    try {
        await connectDB();

        return res.json({
            success: true,
            state: mongoose.connection.readyState
        });
    } catch (e) {
        return res.status(500).json({
            success: false,
            error: e.message
        });
    }
});

/** Root response without DB — isolates “function crashed” vs “Mongo misconfigured”. */

app.get('/', (req, res) => {

    res.status(200).json({

        ok: true,

        message: 'API is running',

        health: 'GET /health',

        mongoConfigured: Boolean(process.env.MONGO_URL_YWAELE || process.env.MONGO_URL),

        note: '/api/* uses MONGO_URL_YWAELE (preferred) or MONGO_URL.',

    });

});



app.use('/uploads', express.static(path.join(__dirname, 'uploads')));



const httpStatusText = require('./utils/httpStatus');



const paymentController = require('./controllers/payment.controllers');

app.post(

    '/api/payments/stripe/webhook',

    express.raw({ type: 'application/json' }),

    async (req, res) => {

        try {

            await connectDB();

            await paymentController.stripeWebhook(req, res);

        } catch (err) {

            if (!res.headersSent) {

               // corsMiddleware.applyCorsHeaders(req, res);

                res.status(500).json({ error: err.message });

            }

        }

    }

);



// Lazy routes: parse controllers only after Mongo connects.

// app.use('/api', async (req, res, next) => {

//     try {

//         await connectDB();

//         getApiRouter()(req, res, (err) => {

//             if (err) {

//                 return next(err);

//             }

//             next();

//         });

//     } catch (e) {

//         next(e);

//     }

// });

app.use('/api', async (req, res, next) => {

    if (req.method === 'OPTIONS') {

        corsMiddleware.applyCorsHeaders(req, res);

        return res.sendStatus(204);

    }



    try {

        await connectDB();

        return getApiRouter()(req, res, next);

    } catch (e) {

        next(e);

    }

});

// Serve Thriftit HTML after /api so API routes always return JSON, not static files.
const frontendPath = process.env.SERVE_FRONTEND_PATH;
if (frontendPath) {
    app.use(express.static(path.resolve(frontendPath)));
}

app.use((req, res) => {

    corsMiddleware.applyCorsHeaders(req, res);

    res.status(404).json({ status: httpStatusText.ERROR, message: 'this resource is not available' });

});



app.use((error, req, res, next) => {

    corsMiddleware.applyCorsHeaders(req, res);

    res.status(error.statusCode || 500).json({

        status: error.statusText || httpStatusText.ERROR,

        message: error.message,

        code: error.statusCode || 500,

        data: null,

    });

});



module.exports = app;
