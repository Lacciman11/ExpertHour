import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

import registerMiddlewares, { errorHandler }
    from "./middlewares/index.js";
import registerRoutes from "./routes/index.js";
import paymentReconciliationService from "./services/payment-reconciliation.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/*
|--------------------------------------------------------------------------
| Trust Proxy
|--------------------------------------------------------------------------
|
| Required for express-rate-limit to correctly identify clients behind
| a reverse proxy (e.g. Render, Heroku, AWS ELB). Without this,
| rate-limit sees the proxy IP instead of the real client IP and
| throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
|--------------------------------------------------------------------------
*/

app.set("trust proxy", 1);

/*
|--------------------------------------------------------------------------
| Raw Body Capture for Webhook Signature Verification
|--------------------------------------------------------------------------
|
| Paystack computes the webhook signature over the raw request body.
| express.json() parses the body before our controller runs, so we
| capture the raw bytes here for HMAC verification.
|--------------------------------------------------------------------------
*/

app.use((req, res, next) => {

    if (req.path === "/api/v1/payments/webhook" && req.method === "POST") {

        let rawBody = "";

        req.setEncoding("utf8");

        req.on("data", (chunk) => {

            rawBody += chunk;

        });

        req.on("end", () => {

            req.rawBody = rawBody;

            next();

        });

    } else {

        next();

    }

});

/*
|--------------------------------------------------------------------------
| Global Middlewares
|--------------------------------------------------------------------------
*/

registerMiddlewares(app);

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
*/

registerRoutes(app);

/*
|--------------------------------------------------------------------------
| Health Check
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Welcome to ExpertHour API 🚀",
    });
});

/**
 * Payment service health/readiness check.
 *
 * Determines:
 * 1. MongoDB availability
 * 2. Paystack configuration availability
 * 3. Payment reconciliation worker status
 *
 * NEVER exposes:
 * - PAYSTACK_SECRET_KEY
 * - API credentials
 * - JWTs
 * - tokens
 */
app.get("/health/payment", async (req, res) => {

    const health = {

        status: "healthy",

        checks: {

            mongodb: { status: "unknown" },

            paystack: { status: "unknown" },

            reconciliationWorker: { status: "unknown" },

        },

    };

    // Check MongoDB
    try {

        if (mongoose.connection.readyState === 1) {

            health.checks.mongodb = { status: "healthy" };

        } else {

            health.checks.mongodb = { status: "unhealthy", detail: `readyState=${mongoose.connection.readyState}` };

            health.status = "unhealthy";

        }

    } catch (error) {

        health.checks.mongodb = { status: "unhealthy", detail: error.message };

        health.status = "unhealthy";

    }

    // Check Paystack configuration
    try {

        const hasPrimary = !!process.env.PAYSTACK_SECRET_KEY;

        const hasSecondary = !!process.env.PAYSTACK_SECRET_KEY_OLD;

        health.checks.paystack = {

            status: hasPrimary ? "healthy" : "unhealthy",

            detail: hasPrimary ? "primary key configured" : "PAYSTACK_SECRET_KEY missing",

            hasSecondary,

        };

        if (!hasPrimary) {

            health.status = "unhealthy";

        }

    } catch (error) {

        health.checks.paystack = { status: "unhealthy", detail: error.message };

        health.status = "unhealthy";

    }

    // Check reconciliation worker
    try {

        const workerStatus = paymentReconciliationService.isRunning ? "running" : "stopped";

        health.checks.reconciliationWorker = { status: workerStatus };

    } catch (error) {

        health.checks.reconciliationWorker = { status: "unhealthy", detail: error.message };

    }

    const httpStatus = health.status === "healthy" ? 200 : health.status === "degraded" ? 503 : 503;

    res.status(httpStatus).json({

        success: health.status === "healthy",

        health,

    });

});

/*
|--------------------------------------------------------------------------
| Serve Frontend (SPA fallback)
|--------------------------------------------------------------------------
*/

app.use(express.static(path.join(__dirname, "../public")));

app.get("/{*path}", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
});

/*
|--------------------------------------------------------------------------
| Global Error Handler
|--------------------------------------------------------------------------
*/

app.use(errorHandler);

export default app;
