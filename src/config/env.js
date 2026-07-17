import dotenv from "dotenv";

dotenv.config();

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
