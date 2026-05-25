/** Local Node server — connects MongoDB then listens on PORT (default 4000). */
require('dotenv').config();

const connectDB = require('./config/database');
const app = require('./app');

function startServer(port) {
    const host = process.env.HOST || '0.0.0.0';
    app.listen(port, host, () => {
        console.log(`listening on http://localhost:${port}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(
                `Port ${port} is already in use. Stop the other "npm run run:dev" terminal, then try again.`
            );
        } else {
            console.error(err);
        }
        process.exit(1);
    });
}

connectDB()
    .then(() => {
        startServer(Number(process.env.PORT) || 4000);
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
