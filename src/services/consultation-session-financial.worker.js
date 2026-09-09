/**
 * Phase 6A — Task 8: Consultation Session Financial Worker
 *
 * Background worker that consumes terminal ConsultationSession.outcome
 * values and drives the financial consequences (earning creation,
 * refund issuance).
 *
 * This worker is separate from the outcome worker. The outcome worker
 * is responsible only for:
 *   attendance → outcome
 *
 * This worker is responsible for:
 *   outcome → financial consequence
 *
 * Design principles:
 *   1. Discovers sessions with terminal outcomes that have not yet been
 *      processed financially.
 *   2. Materializes ConsultationSession for no-activity bookings before
 *      processing (addresses lazy session creation risk).
 *   3. Delegates to consultationSessionFinancialService.processSessionOutcome().
 *   4. Uses recursive setTimeout (matching project pattern).
 *   5. No overlapping cycles.
 *   6. Configuration from environment/config.
 *   7. Clean shutdown.
 *   8. Restarting safely resumes unfinished work.
 */

import mongoose from "mongoose";

import consultationSessionFinancialService from "./consultation-session-financial.service.js";
import env from "../config/env.js";
import paymentLogger from "../utils/logger.js";

const { intervalMs } = env.consultationSessionFinancial;

class ConsultationSessionFinancialWorker {

    constructor() {

        this.isRunning = false;

        this.shutdownRequested = false;

        this.timerId = null;

        // Process all unprocessed sessions in a single cycle.
        this.batchSize = 50;

    }

    // -------------------------------------------------------------------
    // Lifecycle (recursive setTimeout, matching project pattern)
    // -------------------------------------------------------------------

    start() {

        if (this.isRunning) {

            paymentLogger.info("financial_worker_already_running", {
                event: "financial_worker_already_running",
            });

            return;

        }

        this.isRunning = true;
        this.shutdownRequested = false;

        paymentLogger.info("financial_worker_starting", {
            event: "financial_worker_starting",
            intervalMs,
        });

        this._scheduleNext();

    }

    stop() {

        this.shutdownRequested = true;

        if (this.timerId) {

            clearTimeout(this.timerId);

            this.timerId = null;

        }

        // Synchronously mark the worker as stopped so callers can
        // observe the new state immediately.
        this.isRunning = false;

        paymentLogger.info("financial_worker_shutdown_requested", {
            event: "financial_worker_shutdown_requested",
        });

    }

    _scheduleNext() {

        if (this.shutdownRequested) {

            this.isRunning = false;

            paymentLogger.info("financial_worker_stopped", {
                event: "financial_worker_stopped",
            });

            return;

        }

        this.timerId = setTimeout(() => {

            this._runCycle().finally(() => {

                this._scheduleNext();

            });

        }, intervalMs);

    }

    // -------------------------------------------------------------------
    // Cycle Execution
    // -------------------------------------------------------------------

    async _runCycle() {

        const cycleStart = Date.now();

        paymentLogger.info("financial_cycle_started", {
            event: "financial_cycle_started",
            cycleStart: new Date(cycleStart).toISOString(),
        });

        let discovered = 0;
        let processed = 0;
        let succeeded = 0;
        let failed = 0;

        try {

            const items = await consultationSessionFinancialService.findUnprocessedSessions(
                this.batchSize
            );
            discovered = items.length;

            for (const { session, booking, payment } of items) {

                processed += 1;

                try {

                    // Materialize session if missing (no-activity booking).
                    const materializedSession =
                        await consultationSessionFinancialService.ensureSessionExists(
                            booking._id.toString()
                        );

                    if (!materializedSession) {
                        paymentLogger.warn("financial_session_materialization_failed", {
                            event: "financial_session_materialization_failed",
                            bookingId: booking._id.toString(),
                        });
                        continue;
                    }

                    // Process financial consequences.
                    const result = await consultationSessionFinancialService.processSessionOutcome(
                        materializedSession._id.toString()
                    );

                    succeeded += 1;

                    paymentLogger.info("financial_processed", {
                        event: "financial_processed",
                        sessionId: materializedSession._id.toString(),
                        bookingId: booking._id.toString(),
                        outcome: result.outcome,
                        earningCreated: result.earning.created,
                        earningStatus: result.earning.status,
                        refundSuccess: result.refund ? result.refund.success : null,
                    });

                } catch (err) {

                    failed += 1;

                    paymentLogger.error("financial_processing_failed", {
                        event: "financial_processing_failed",
                        sessionId: session._id.toString(),
                        bookingId: booking._id.toString(),
                        error: err.message,
                    });

                }

            }

        } catch (error) {

            paymentLogger.error("financial_cycle_failed", {
                event: "financial_cycle_failed",
                error: error.message,
            });

        }

        paymentLogger.info("financial_cycle_completed", {
            event: "financial_cycle_completed",
            discovered,
            processed,
            succeeded,
            failed,
            cycleDurationMs: Date.now() - cycleStart,
        });

    }

}

// ---------------------------------------------------------------------------
// Export Singleton
// ---------------------------------------------------------------------------

export default new ConsultationSessionFinancialWorker();
