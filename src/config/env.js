import dotenv from "dotenv";

dotenv.config();

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
