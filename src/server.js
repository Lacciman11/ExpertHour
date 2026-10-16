import mongoose from "mongoose";

import app from "./app.js";

import consultationSessionOutcomeService from "./services/consultation-session-outcome.service.js";
import consultationSessionFinancialWorker from "./services/consultation-session-financial.worker.js";
import earningEligibilityService from "./services/earning-eligibility.service.js";
import paymentReconciliationService from "./services/payment-reconciliation.service.js";
import refundReconciliationService from "./services/refund-reconciliation.service.js";
import payoutProcessingService from "./services/payout-processing.service.js";
import payoutReconciliationService from "./services/payout-reconciliation.service.js";
import googleMeetAttendanceWorker from "./services/google-meet-attendance.worker.js";
import emailOutboxWorker from "./services/email-outbox.worker.js";
import bookingReminderService from "./services/booking-reminder.service.js";
import reviewRequestService from "./services/review-request.service.js";
import notificationRealtime from "./realtime/notification.socket.js";

import env from "./config/env.js";
import paymentLogger from "./utils/logger.js";

const PORT = env.port;

// ---------------------------------------------------------------------------
// Database Connection
// ---------------------------------------------------------------------------

async function connectDatabase() {

    try {

        await mongoose.connect(env.mongoUri);

        paymentLogger.info("database_connected", {

            event: "database_connected",

            uri: env.mongoUri.replace(/\/\/.*@/, "//***@"),

        });

    } catch (error) {

        paymentLogger.error("database_connection_failed", {

            event: "database_connection_failed",

            error: error.message,

        });

        process.exit(1);

    }

}

// ---------------------------------------------------------------------------
// Start Workers
// ---------------------------------------------------------------------------

function startWorkers() {

    // Outcome worker: attendance → outcome
    consultationSessionOutcomeService.start();

    // Financial worker: outcome → financial consequence
    consultationSessionFinancialWorker.start();

    // Earning eligibility worker: PENDING → ELIGIBLE after 24h
    earningEligibilityService.start();

    // Payment reconciliation worker: recovers pending/processing payments
    paymentReconciliationService.start();

    // Refund reconciliation worker: reconciles failed local refund transactions
    refundReconciliationService.start();

    // Payout processing worker: creates payout cycles for eligible earnings
    payoutProcessingService.start();

    // Payout reconciliation worker: recovers PROCESSING payouts after crash
    payoutReconciliationService.start();

    // Google Meet attendance sync worker: synchronizes Google Meet attendance
    googleMeetAttendanceWorker.start();

    // Email outbox worker: durable, retryable email delivery
    emailOutboxWorker.start();

    // Booking reminder worker: 24h/1h reminders for confirmed sessions
    bookingReminderService.start();

    // Review request worker: asks the client to review 1h after COMPLETED
    reviewRequestService.start();

    paymentLogger.info("workers_started", {

        event: "workers_started",

    });

}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

// Hard ceiling on shutdown. A hung cleanup step must never prevent the process
// from terminating, so the deadline force-exits with a failure code.
const SHUTDOWN_TIMEOUT_MS = 10000;

// Re-entrancy guard. SIGINT and SIGTERM can both arrive (Ctrl-C followed by an
// orchestrator signal); without this, two shutdowns would race each other.
let shutdownInProgress = false;

// Handle for the deadline timer, cleared once cleanup finishes.
let shutdownDeadline = null;

/**
 * Run one cleanup stage, capturing any failure so later stages still run.
 *
 * A stage may report failure either by throwing/rejecting or by RETURNING an
 * Error — `closeHttpServer()` uses the latter — so both are treated alike.
 *
 * @param {string} step - stage name, used only for logging
 * @param {Function} run - the stage body
 * @returns {Promise<Error|null>} the stage's error, or null on success
 */
async function runCleanupStep(step, run) {

    try {

        const result = await run();

        return result instanceof Error ? result : null;

    } catch (error) {

        paymentLogger.error("shutdown_step_failed", {

            event: "shutdown_step_failed",

            step,

            error: error?.message || error,

        });

        return error instanceof Error ? error : new Error(String(error));

    }

}

/**
 * Close the shared HTTP server exactly once and resolve when it has drained.
 *
 * The callback receives an error when the server was not running, so the
 * result is reported honestly rather than logged as a successful close.
 *
 * @returns {Promise<Error|null>} the close error, or null on success
 */
function closeHttpServer() {

    return new Promise((resolve) => {

        if (!server) {
            resolve(null);
            return;
        }

        // Close idle keep-alive sockets promptly so the close callback can
        // fire. In-flight requests are left to finish naturally.
        if (typeof server.closeIdleConnections === "function") {
            server.closeIdleConnections();
        }

        server.close((error) => {

            if (error) {

                paymentLogger.error("http_server_close_failed", {

                    event: "http_server_close_failed",

                    error: error.message,

                });

                resolve(error);

            } else {

                paymentLogger.info("http_server_closed", {

                    event: "http_server_closed",

                });

                resolve(null);

            }

        });

    });

}

async function gracefulShutdown(signal) {

    if (shutdownInProgress) {

        paymentLogger.info("shutdown_already_in_progress", {

            event: "shutdown_already_in_progress",

            signal,

        });

        return;

    }

    shutdownInProgress = true;

    // Hard deadline. `unref()` keeps the timer from holding the event loop
    // open by itself; the explicit process.exit below is what guarantees
    // termination.
    shutdownDeadline = setTimeout(() => {

        paymentLogger.error("shutdown_deadline_exceeded", {

            event: "shutdown_deadline_exceeded",

            signal,

        });

        process.exit(1);

    }, SHUTDOWN_TIMEOUT_MS);

    shutdownDeadline.unref();

    paymentLogger.info("shutdown_signal", {

        event: "shutdown_signal",

        signal,

    });

    // Each stage runs independently and in order. A failure in one stage is
    // captured, not propagated, so the HTTP server and MongoDB are always
    // cleaned up even if an earlier stage fails.
    const stageErrors = [

        // 1. Stop workers first so no new work starts.
        await runCleanupStep("workers", () => {
            consultationSessionOutcomeService.stop();
            consultationSessionFinancialWorker.stop();
            earningEligibilityService.stop();
            paymentReconciliationService.stop();
            refundReconciliationService.stop();
            payoutProcessingService.stop();
            payoutReconciliationService.stop();
            googleMeetAttendanceWorker.stop();
            emailOutboxWorker.stop();
            bookingReminderService.stop();
            reviewRequestService.stop();
        }),

        // 2. Disconnect Socket.IO clients and release the engine. This does
        //    NOT close the shared HTTP server.
        await runCleanupStep("realtime", () => notificationRealtime.close()),

        // 3. Close the shared HTTP server exactly once and wait for it.
        await runCleanupStep("http", () => closeHttpServer()),

        // 4. Close database connection
        await runCleanupStep("mongodb", () => mongoose.disconnect()),

    ];

    const fatalError = stageErrors.find((error) => error !== null) || null;

    clearTimeout(shutdownDeadline);

    shutdownDeadline = null;

    if (fatalError) {

        paymentLogger.error("shutdown_completed_with_errors", {

            event: "shutdown_completed_with_errors",

        });

        process.exit(1);

    }

    paymentLogger.info("shutdown_complete", {

        event: "shutdown_complete",

    });

    process.exit(0);

}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let server;

async function bootstrap() {

    await connectDatabase();

    server = app.listen(PORT, () => {

        paymentLogger.info("server_started", {

            event: "server_started",

            port: PORT,

            env: env.nodeEnv,

        });

    });

    // Attach Socket.IO to the SAME HTTP server. No new listener or port.
    notificationRealtime.attach(server, [
        env.appUrl,
        process.env.FRONTEND_URL,
        "http://localhost:5000",
        "http://localhost:5173",
    ].filter(Boolean));

    startWorkers();

    // Register shutdown handlers. An unexpected rejection is logged and turned
    // into a nonzero exit rather than becoming an unhandled rejection. The
    // normal path exits from inside gracefulShutdown, so this only runs when
    // something throws before that.
    const handleShutdownSignal = (signal) => {

        gracefulShutdown(signal).catch((error) => {

            paymentLogger.error("shutdown_handler_failed", {

                event: "shutdown_handler_failed",

                signal,

                error: error?.message || error,

            });

            process.exit(1);

        });

    };

    process.on("SIGINT", () => handleShutdownSignal("SIGINT"));
    process.on("SIGTERM", () => handleShutdownSignal("SIGTERM"));

}

bootstrap().catch((error) => {

    paymentLogger.error("bootstrap_failed", {

        event: "bootstrap_failed",

        error: error.message,

    });

    process.exit(1);

});
