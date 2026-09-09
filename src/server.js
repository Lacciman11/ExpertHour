import mongoose from "mongoose";

import app from "./app.js";

import consultationSessionOutcomeService from "./services/consultation-session-outcome.service.js";
import consultationSessionFinancialWorker from "./services/consultation-session-financial.worker.js";
import earningEligibilityService from "./services/earning-eligibility.service.js";

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

    paymentLogger.info("workers_started", {

        event: "workers_started",

    });

}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

async function gracefulShutdown(signal) {

    paymentLogger.info("shutdown_signal", {

        event: "shutdown_signal",

        signal,

    });

    // Stop workers first
    consultationSessionOutcomeService.stop();
    consultationSessionFinancialWorker.stop();
    earningEligibilityService.stop();

    // Close HTTP server
    if (server) {

        server.close(() => {

            paymentLogger.info("http_server_closed", {

                event: "http_server_closed",

            });

        });

    }

    // Close database connection
    await mongoose.disconnect();

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

    startWorkers();

    // Register shutdown handlers
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

}

bootstrap().catch((error) => {

    paymentLogger.error("bootstrap_failed", {

        event: "bootstrap_failed",

        error: error.message,

    });

    process.exit(1);

});
