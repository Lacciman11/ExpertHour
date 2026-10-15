import dotenv from "dotenv";

dotenv.config();

/**
 * Parse an integer environment value, clamped to [min, max].
 *
 * Falls back to `fallback` when the value is missing, non-numeric, or out of
 * range. Used for worker tuning values where a malformed variable must not
 * produce a zero/negative interval or an unbounded batch.
 *
 * @param {string|undefined} raw - the raw environment value
 * @param {number} fallback - safe default
 * @param {number} min - inclusive lower bound
 * @param {number} max - inclusive upper bound
 * @returns {number}
 */
const boundedInt = (raw, fallback, min, max) => {

    if (raw === undefined || raw === null || String(raw).trim() === "") {

        return fallback;

    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed)) {

        return fallback;

    }

    const rounded = Math.floor(parsed);

    if (rounded < min || rounded > max) {

        return fallback;

    }

    return rounded;

};

const env = {

    nodeEnv: process.env.NODE_ENV || "development",

    port: process.env.PORT || 5000,

    mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/experthour",

    jwt: {

        secret: process.env.JWT_SECRET || "your-secret-key-change-in-production",

        expiresIn: process.env.JWT_EXPIRES_IN || "7d",

    },

    jwtAccessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || "your-secret-key-change-in-production",

    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || "your-secret-key-change-in-production",

    // ---------------------------------------------------------------------------
    // Worker Intervals (milliseconds)
    // ---------------------------------------------------------------------------

    consultationSessionOutcome: {

        intervalMs: parseInt(process.env.CONSULTATION_SESSION_OUTCOME_INTERVAL_MS || "60000", 10),

    },

    consultationSessionFinancial: {

        intervalMs: parseInt(process.env.CONSULTATION_SESSION_FINANCIAL_INTERVAL_MS || "120000", 10),

    },

    earningEligibility: {

        intervalMs: parseInt(process.env.EARNING_ELIGIBILITY_INTERVAL_MS || "3600000", 10),

    },

    // ---------------------------------------------------------------------------
    // Booking Reminders
    // ---------------------------------------------------------------------------

    bookingReminder: {

        intervalMs: parseInt(process.env.BOOKING_REMINDER_INTERVAL_MS || "300000", 10),

        batchSize: parseInt(process.env.BOOKING_REMINDER_BATCH_SIZE || "50", 10),

        // Lead durations (milliseconds) before ConsultationSession.scheduledStart.
        lead24hMs: parseInt(process.env.BOOKING_REMINDER_24H_LEAD_MS || String(24 * 60 * 60 * 1000), 10),

        lead1hMs: parseInt(process.env.BOOKING_REMINDER_1H_LEAD_MS || String(60 * 60 * 1000), 10),

    },

    // ---------------------------------------------------------------------------
    // Review Requests
    // ---------------------------------------------------------------------------

    // Asks the client to review a consultation one hour after the session is
    // finalized as COMPLETED. The delay is anchored on the server-derived
    // ConsultationSession.outcomeFinalizedAt, never on a client-controlled
    // timestamp. Values are bounded so a malformed variable cannot produce a
    // zero/negative interval, an unbounded batch, or a negative delay.
    reviewRequest: {

        intervalMs: boundedInt(process.env.REVIEW_REQUEST_INTERVAL_MS, 300000, 1000, 3600000),

        batchSize: boundedInt(process.env.REVIEW_REQUEST_BATCH_SIZE, 50, 1, 100),

        delayMs: boundedInt(
            process.env.REVIEW_REQUEST_DELAY_MS,
            60 * 60 * 1000,
            0,
            7 * 24 * 60 * 60 * 1000
        ),

    },

    // ---------------------------------------------------------------------------
    // Payment Reconciliation
    // ---------------------------------------------------------------------------

    paymentReconciliation: {

        intervalMs: parseInt(process.env.PAYMENT_RECONCILIATION_INTERVAL_MS || "300000", 10),

        delayMs: parseInt(process.env.PAYMENT_RECONCILIATION_DELAY_MS || "5000", 10),

        processingTimeoutMs: parseInt(process.env.PAYMENT_RECONCILIATION_TIMEOUT_MS || "30000", 10),

        maxAttempts: parseInt(process.env.PAYMENT_RECONCILIATION_MAX_ATTEMPTS || "3", 10),

        batchSize: parseInt(process.env.PAYMENT_RECONCILIATION_BATCH_SIZE || "10", 10),

    },

    // ---------------------------------------------------------------------------
    // Refund Reconciliation
    // ---------------------------------------------------------------------------

    refundReconciliation: {

        intervalMs: parseInt(process.env.REFUND_RECONCILIATION_INTERVAL_MS || "300000", 10),

        delayMs: parseInt(process.env.REFUND_RECONCILIATION_DELAY_MS || "5000", 10),

        batchSize: parseInt(process.env.REFUND_RECONCILIATION_BATCH_SIZE || "10", 10),

    },

    // ---------------------------------------------------------------------------
    // Payout Processing
    // ---------------------------------------------------------------------------

    payoutProcessing: {

        intervalMs: parseInt(process.env.PAYOUT_PROCESSING_INTERVAL_MS || "3600000", 10),

        delayMs: parseInt(process.env.PAYOUT_PROCESSING_DELAY_MS || "300000", 10),

        processingTimeoutMs: parseInt(process.env.PAYOUT_PROCESSING_TIMEOUT_MS || "600000", 10),

        maxAttempts: parseInt(process.env.PAYOUT_PROCESSING_MAX_ATTEMPTS || "3", 10),

        batchSize: parseInt(process.env.PAYOUT_PROCESSING_BATCH_SIZE || "20", 10),

    },

    // ---------------------------------------------------------------------------
    // Payout Reconciliation
    // ---------------------------------------------------------------------------

    payoutReconciliation: {

        intervalMs: parseInt(process.env.PAYOUT_RECONCILIATION_INTERVAL_MS || "300000", 10),

        delayMs: parseInt(process.env.PAYOUT_RECONCILIATION_DELAY_MS || "5000", 10),

        batchSize: parseInt(process.env.PAYOUT_RECONCILIATION_BATCH_SIZE || "20", 10),

    },

    // ---------------------------------------------------------------------------
    // Google Meet Attendance Sync
    // ---------------------------------------------------------------------------

    googleMeetAttendance: {

        intervalMs: parseInt(process.env.GOOGLE_MEET_ATTENDANCE_INTERVAL_MS || "300000", 10),

        syncRetryIntervalMs: parseInt(process.env.GOOGLE_MEET_ATTENDANCE_RETRY_INTERVAL_MS || "3600000", 10),

        batchSize: parseInt(process.env.GOOGLE_MEET_ATTENDANCE_BATCH_SIZE || "20", 10),

    },

    // ---------------------------------------------------------------------------
    // Email Outbox
    // ---------------------------------------------------------------------------

    // Durable, retryable email delivery. Values are bounded so a malformed
    // environment variable cannot produce a zero/negative interval, an
    // unbounded batch, or a retry policy that never terminates. Out-of-range
    // values fall back to the safe default rather than crashing startup.

    emailOutbox: {

        intervalMs: boundedInt(process.env.EMAIL_OUTBOX_INTERVAL_MS, 300000, 1000, 3600000),

        batchSize: boundedInt(process.env.EMAIL_OUTBOX_BATCH_SIZE, 10, 1, 100),

        maxAttempts: boundedInt(process.env.EMAIL_OUTBOX_MAX_ATTEMPTS, 5, 1, 20),

        baseDelayMs: boundedInt(process.env.EMAIL_OUTBOX_BASE_DELAY_MS, 30000, 1000, 3600000),

        maxDelayMs: boundedInt(process.env.EMAIL_OUTBOX_MAX_DELAY_MS, 3600000, 1000, 86400000),

        leaseMs: boundedInt(process.env.EMAIL_OUTBOX_LEASE_MS, 300000, 10000, 3600000),

    },

    // ---------------------------------------------------------------------------
    // Paystack
    // ---------------------------------------------------------------------------

    paystack: {

        secretKey: process.env.PAYSTACK_SECRET_KEY || "",

        publicKey: process.env.PAYSTACK_PUBLIC_KEY || "",

    },

    // ---------------------------------------------------------------------------
    // Cloudinary
    // ---------------------------------------------------------------------------

    cloudinary: {

        cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",

        apiKey: process.env.CLOUDINARY_API_KEY || "",

        apiSecret: process.env.CLOUDINARY_API_SECRET || "",

    },

    // ---------------------------------------------------------------------------
    // Email
    // ---------------------------------------------------------------------------

    email: {

        host: process.env.EMAIL_HOST || "smtp.gmail.com",

        port: parseInt(process.env.EMAIL_PORT || "587", 10),

        secure: process.env.EMAIL_SECURE === "true",

        user: process.env.EMAIL_USER || "",

        password: process.env.EMAIL_PASSWORD || "",

        from: process.env.EMAIL_FROM || "ExpertHour <noreply@experthour.com>",

    },

    // ---------------------------------------------------------------------------
    // Google Calendar
    // ---------------------------------------------------------------------------

    googleCalendar: {

        clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID || "",

        clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET || "",

        redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI || "",

    },

    // ---------------------------------------------------------------------------
    // Frontend URL
    // ---------------------------------------------------------------------------

    frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",

    appUrl: process.env.APP_URL || process.env.FRONTEND_URL || "http://localhost:5173",

    // ---------------------------------------------------------------------------
    // Google Sheets
    // ---------------------------------------------------------------------------

    googleSheets: {

        spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || "",

        sheetName: process.env.GOOGLE_SHEET_NAME || "Sheet1",

        serviceAccountKey: process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "",

    },

    // ---------------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------------

    admin: {

        email: process.env.ADMIN_EMAIL || "admin@experthour.com",

        password: process.env.ADMIN_PASSWORD || "admin123",

    },

};

export default env;
