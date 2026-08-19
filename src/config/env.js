import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read .env file manually to avoid issues with dotenv interceptors/extensions
const envPath = path.join(__dirname, "../../.env");
const envContent = fs.readFileSync(envPath, "utf8");
const envVars = {};

envContent.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) return;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key) {
        envVars[key] = value;
    }
});

// Populate process.env with values from .env (overwrite to ensure correctness)
Object.entries(envVars).forEach(([key, value]) => {
    process.env[key] = value;
});

const env = {
    port: process.env.PORT || 5000,

    nodeEnv: process.env.NODE_ENV,

    mongoURI: process.env.MONGO_URI,
    
    appUrl: process.env.APP_URL,

    jwtAccessSecret: process.env.JWT_ACCESS_SECRET,

    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,

    jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN,

    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN,

    email: {
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        user: process.env.EMAIL_USER,
        password: process.env.EMAIL_PASSWORD,
        from: process.env.EMAIL_FROM,
    },

    cloudinary: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET,
    },

    googleCalendar: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        redirectUri: process.env.GOOGLE_REDIRECT_URI,
    },

    paymentReconciliation: {
        intervalMs: Number(process.env.PAYMENT_RECONCILIATION_INTERVAL_MS) || 60000,
        delayMs: Number(process.env.PAYMENT_RECONCILIATION_DELAY_MS) || 300000,
        processingTimeoutMs: Number(process.env.PAYMENT_PROCESSING_TIMEOUT_MS) || 300000,
        maxAttempts: Number(process.env.PAYMENT_MAX_RECONCILIATION_ATTEMPTS) || 10,
        batchSize: Number(process.env.PAYMENT_RECONCILIATION_BATCH_SIZE) || 20,
    },
};

/*
|--------------------------------------------------------------------------
| Startup validation
|
| Fails fast if any required configuration is missing so the app does not
| start with broken reset links (APP_URL) or unsigned tokens (JWT secrets).
|--------------------------------------------------------------------------
*/

const requiredVars = [
    "PORT",
    "MONGO_URI",
    "APP_URL",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "EMAIL_HOST",
    "EMAIL_PORT",
    "EMAIL_USER",
    "EMAIL_PASSWORD",
    "EMAIL_FROM",
];

export function validateEnv() {

    const missing = requiredVars.filter(
        (key) => !process.env[key]
    );

    if (missing.length > 0) {

        throw new Error(
            `Missing required environment variables: ${missing.join(", ")}`
        );

    }

    const numericVars = ["PORT", "EMAIL_PORT"];

    const invalidNumeric = numericVars.filter(
        (key) => Number.isNaN(Number(process.env[key]))
    );

    if (invalidNumeric.length > 0) {

        throw new Error(
            `The following environment variables must be numeric: ${invalidNumeric.join(", ")}`
        );

    }

}

export default env;
