import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import paymentService from "./payment.service.js";
import env from "../config/env.js";
import paymentLogger from "../utils/logger.js";

const {
    intervalMs,
    delayMs,
    processingTimeoutMs,
    maxAttempts,
    batchSize,
} = env.paymentReconciliation;

/**
 * PaymentReconciliationService
 *
 * Recovery orchestrator for payments that have not been reconciled.
 * This service does NOT duplicate reconciliation logic.
 * It delegates all financial decisions to paymentService.reconcilePayment().
 */
class PaymentReconciliationService {

    constructor() {

        this.isRunning = false;

        this.shutdownRequested = false;

        this.timerId = null;

    }

    /**
     * Start the reconciliation worker.
     * Must be called after MongoDB connection is established.
     */
    start() {

        if (this.isRunning) {

            paymentLogger.info("reconciliation_worker_already_running", {

                event: "reconciliation_worker_already_running",

            });

            return;

        }

        this.isRunning = true;

        this.shutdownRequested = false;

        paymentLogger.info("reconciliation_worker_starting", {

            event: "reconciliation_worker_starting",

            intervalMs,

            delayMs,

            processingTimeoutMs,

            maxAttempts,

            batchSize,

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

        paymentLogger.info("reconciliation_worker_shutdown_requested", {

            event: "reconciliation_worker_shutdown_requested",

        });

    }

    /**
     * Schedule the next reconciliation cycle.
     * Uses recursive setTimeout to prevent overlapping executions.
     */
    _scheduleNext() {

        if (this.shutdownRequested) {

            this.isRunning = false;

            paymentLogger.info("reconciliation_worker_stopped", {

                event: "reconciliation_worker_stopped",

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
     * Execute one reconciliation cycle.
     */
    async _runCycle() {

        const cycleStart = Date.now();

        paymentLogger.info("reconciliation_cycle_started", {

            event: "reconciliation_cycle_started",

            cycleStart: new Date(cycleStart).toISOString(),

        });

        try {

            const candidates = await this._findCandidates();

            paymentLogger.info("reconciliation_candidates_found", {

                event: "reconciliation_candidates_found",

                count: candidates.length,

            });

            let processed = 0;

            let succeeded = 0;

            let failed = 0;

            let maxReached = 0;

            for (const payment of candidates) {

                if (this.shutdownRequested) {

                    paymentLogger.info("reconciliation_shutdown_during_cycle", {

                        event: "reconciliation_shutdown_during_cycle",

                    });

                    break;

                }

                processed++;

                try {

                    const result = await paymentService.reconcilePayment(payment.reference);

                    if (result.success) {

                        succeeded++;

                        paymentLogger.info("reconciliation_payment_recovered", {

                            event: "reconciliation_payment_recovered",

                            reference: payment.reference,

                            status: "success",

                        });

                    } else if (result.status === "processing") {

                        paymentLogger.info("reconciliation_payment_skipped_processing", {

                            event: "reconciliation_payment_skipped_processing",

                            reference: payment.reference,

                        });

                    } else {

                        failed++;

                        paymentLogger.info("reconciliation_payment_not_successful", {

                            event: "reconciliation_payment_not_successful",

                            reference: payment.reference,

                            reason: result.reason,

                        });

                    }

                } catch (error) {

                    failed++;

                    if (error instanceof Error && error.message.includes("maximum retry")) {

                        maxReached++;

                        paymentLogger.error("reconciliation_max_retries_reached", {

                            event: "reconciliation_max_retries_reached",

                            reference: payment.reference,

                            error: error.message,

                        });

                    } else {

                        paymentLogger.error("reconciliation_payment_error", {

                            event: "reconciliation_payment_error",

                            reference: payment.reference,

                            error: error.message,

                        });

                    }

                }

            }

            const cycleDuration = Date.now() - cycleStart;

            paymentLogger.info("reconciliation_cycle_completed", {

                event: "reconciliation_cycle_completed",

                cycleDurationMs: cycleDuration,

                processed,

                succeeded,

                failed,

                maxReached,

            });

        } catch (error) {

            paymentLogger.error("reconciliation_cycle_failed", {

                event: "reconciliation_cycle_failed",

                error: error.message,

            });

        }

    }

    /**
     * Find payments eligible for reconciliation recovery.
     *
     * Eligible payments:
     * 1. pending: created longer than delayMs ago, attempts < maxAttempts
     * 2. processing: processingStartedAt older than processingTimeoutMs, attempts < maxAttempts
     *
     * NOT eligible:
     * - success, failed, abandoned
     * - recently created pending payments (within delayMs)
     * - fresh processing payments (within processingTimeoutMs)
     * - payments that have exceeded maxAttempts
     */
    async _findCandidates() {

        const now = new Date();

        const pendingCutoff = new Date(now.getTime() - delayMs);

        const processingCutoff = new Date(now.getTime() - processingTimeoutMs);

        // Query for pending payments that are old enough and haven't exceeded max attempts.
        const pendingPayments = await Payment.find({
            status: "pending",
            createdAt: { $lt: pendingCutoff },
            reconciliationAttempts: { $lt: maxAttempts },
        })
            .sort({ createdAt: 1 })
            .limit(batchSize)
            .lean();

        // Query for stale processing payments.
        const processingPayments = await Payment.find({
            status: "processing",
            processingStartedAt: { $lt: processingCutoff },
            reconciliationAttempts: { $lt: maxAttempts },
        })
            .sort({ processingStartedAt: 1 })
            .limit(batchSize)
            .lean();

        // Merge and deduplicate by reference.
        const seen = new Set();

        const candidates = [];

        for (const payment of [...pendingPayments, ...processingPayments]) {

            if (seen.has(payment.reference)) {

                continue;

            }

            seen.add(payment.reference);

            candidates.push(payment);

        }

        // Sort by creation time (oldest first) and respect batch size.
        candidates.sort((a, b) => a.createdAt - b.createdAt);

        return candidates.slice(0, batchSize);

    }

}

export default new PaymentReconciliationService();
