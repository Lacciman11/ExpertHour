import mongoose from "mongoose";

import consultantEarningService from "./consultant-earning.service.js";

import env from "../config/env.js";

import paymentLogger from "../utils/logger.js";

const { intervalMs } = env.earningEligibility;

/**
 * EarningEligibilityService
 *
 * Background worker that transitions PENDING ConsultantEarnings to ELIGIBLE
 * after the 24-hour eligibility period has passed.
 *
 * This service does NOT duplicate earning creation logic.
 * It delegates all state transitions to consultantEarningService.markEligibleEarnings().
 */
class EarningEligibilityService {

    constructor() {

        this.isRunning = false;

        this.shutdownRequested = false;

        this.timerId = null;

    }

    /**
     * Start the eligibility worker.
     * Must be called after MongoDB connection is established.
     */
    start() {

        if (this.isRunning) {

            paymentLogger.info("eligibility_worker_already_running", {

                event: "eligibility_worker_already_running",

            });

            return;

        }

        this.isRunning = true;

        this.shutdownRequested = false;

        paymentLogger.info("eligibility_worker_starting", {

            event: "eligibility_worker_starting",

            intervalMs,

        });

        this._scheduleNext();

    }

    /**
     * Request graceful shutdown.
     * The current cycle will finish, but no new cycle will start.
     */
    stop() {

        this.shutdownRequested = true;

        if (this.timerId) {

            clearTimeout(this.timerId);

            this.timerId = null;

        }

        paymentLogger.info("eligibility_worker_shutdown_requested", {

            event: "eligibility_worker_shutdown_requested",

        });

    }

    /**
     * Schedule the next eligibility cycle.
     * Uses recursive setTimeout to prevent overlapping executions.
     */
    _scheduleNext() {

        if (this.shutdownRequested) {

            this.isRunning = false;

            paymentLogger.info("eligibility_worker_stopped", {

                event: "eligibility_worker_stopped",

            });

            return;

        }

        this.timerId = setTimeout(() => {

            this._runCycle().finally(() => {

                this._scheduleNext();

            });

        }, intervalMs);

    }

    /**
     * Execute one eligibility cycle.
     */
    async _runCycle() {

        const cycleStart = Date.now();

        paymentLogger.info("eligibility_cycle_started", {

            event: "eligibility_cycle_started",

            cycleStart: new Date(cycleStart).toISOString(),

        });

        try {

            const transitioned = await consultantEarningService.markEligibleEarnings();

            paymentLogger.info("eligibility_cycle_completed", {

                event: "eligibility_cycle_completed",

                transitioned,

                cycleDurationMs: Date.now() - cycleStart,

            });

        } catch (error) {

            paymentLogger.error("eligibility_cycle_failed", {

                event: "eligibility_cycle_failed",

                error: error.message,

            });

        }

    }

}

// ---------------------------------------------------------------------------
// Export Singleton
// ---------------------------------------------------------------------------

export default new EarningEligibilityService();
