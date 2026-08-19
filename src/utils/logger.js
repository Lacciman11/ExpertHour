/**
 * Lightweight structured logger for payment events.
 *
 * NEVER log:
 * - PAYSTACK_SECRET_KEY
 * - JWTs
 * - refresh tokens
 * - Authorization headers
 * - passwords
 * - cookies
 * - card numbers
 * - CVV
 * - sensitive customer information
 * - complete Paystack responses
 */

const SENSITIVE_KEYS = new Set([
    "PAYSTACK_SECRET_KEY",
    "PAYSTACK_SECRET_KEY_OLD",
    "JWT_ACCESS_SECRET",
    "JWT_REFRESH_SECRET",
    "password",
    "refreshToken",
    "accessToken",
    "authorization",
    "cookie",
    "cardNumber",
    "cvv",
    "cvc",
    "secret",
    "token",
]);

function sanitize(obj) {

    if (!obj || typeof obj !== "object") {

        return obj;

    }

    if (Array.isArray(obj)) {

        return obj.map(sanitize);

    }

    const sanitized = {};

    for (const [key, value] of Object.entries(obj)) {

        const lowerKey = key.toLowerCase();

        if (SENSITIVE_KEYS.has(key) || SENSITIVE_KEYS.has(lowerKey)) {

            sanitized[key] = "[REDACTED]";

            continue;

        }

        if (value && typeof value === "object" && !Array.isArray(value)) {

            sanitized[key] = sanitize(value);

            continue;

        }

        sanitized[key] = value;

    }

    return sanitized;

}

class PaymentLogger {

    constructor() {

        this.context = {};

    }

    setContext(context) {

        this.context = { ...this.context, ...context };

    }

    clearContext() {

        this.context = {};

    }

    _log(level, event, data = {}) {

        const entry = {

            timestamp: new Date().toISOString(),

            level,

            event,

            ...this.context,

            ...sanitize(data),

        };

        // Use console methods for now; replace with pino/winston in production.
        switch (level) {

            case "error":
                console.error(JSON.stringify(entry));
                break;

            case "warn":
                console.warn(JSON.stringify(entry));
                break;

            default:
                console.log(JSON.stringify(entry));

        }

    }

    info(event, data) {

        this._log("info", event, data);

    }

    warn(event, data) {

        this._log("warn", event, data);

    }

    error(event, data) {

        this._log("error", event, data);

    }

}

const paymentLogger = new PaymentLogger();

export default paymentLogger;
