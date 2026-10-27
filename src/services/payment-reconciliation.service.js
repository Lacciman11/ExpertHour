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
 
            // Count exhausted payments (pending or stale processing with attempts >= maxAttempts).
            // This is a read-only count query; it does not mutate any records.
            let maxReached = 0;
            try {
                const now = new Date();
                const processingCutoff = new Date(now.getTime() - processingTimeoutMs);
 
                const exhaustedPending = await Payment.find({
                    status: "pending",
                    reconciliationAttempts: { $gte: maxAttempts },
                })
                    .select("reference")
                    .lean();
 
                const exhaustedProcessing = await Payment.find({
                    status: "processing",
                    processingStartedAt: { $lt: processingCutoff },
                    reconciliationAttempts: { $gte: maxAttempts },
                })
                    .select("reference")
                    .lean();
 
                const seen = new Set();
                for (const p of [...exhaustedPending, ...exhaustedProcessing]) {
                    if (seen.has(p.reference)) continue;
                    seen.add(p.reference);
                    maxReached++;
                }
            } catch (countError) {
                paymentLogger.error("reconciliation_max_reached_count_failed", {
                    event: "reconciliation_max_reached_count_failed",
                    error: countError.message,
                });
                // Re-throw to be caught by the outer catch, which logs cycle failure.
                throw countError;
            }
 
            let processed = 0;

            let succeeded = 0;
            let reconciled = 0;
            let alreadyVerified = 0;
            let skippedProcessing = 0;
            let deferred = 0;
            let terminalFailures = 0;
            let transientErrors = 0;
            let unexpectedErrors = 0;
            let failed = 0;
            // `failed` is intentionally NOT a catch-all. It counts only
            // terminal failures (Paystack-confirmed failed status). Skipped
            // (still processing) and deferred (non-terminal Paystack status,
            // reverted to pending) are NOT failures — they are recoverable
            // outcomes that will be retried in a future cycle.

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
                        if (result.alreadyVerified) {
                            alreadyVerified++;
                        } else {
                            reconciled++;
                        }
                        succeeded++;

                        paymentLogger.info("reconciliation_payment_recovered", {
                            event: "reconciliation_payment_recovered",
                            reference: payment.reference,
                            status: "success",
                            alreadyVerified: !!result.alreadyVerified,
                        });

                    } else if (result.status === "processing") {
                        skippedProcessing++;

                        paymentLogger.info("reconciliation_payment_skipped_processing", {
                            event: "reconciliation_payment_skipped_processing",
                            reference: payment.reference,
                        });

                    } else if (result.status === "pending") {
                        deferred++;

                        paymentLogger.info("reconciliation_payment_deferred", {
                            event: "reconciliation_payment_deferred",
                            reference: payment.reference,
                            reason: result.reason,
                        });

                    } else {
                        terminalFailures++;
                        failed++;

                        paymentLogger.info("reconciliation_payment_terminal_failure", {
                            event: "reconciliation_payment_terminal_failure",
                            reference: payment.reference,
                            reason: result.reason,
                        });

                    }

                } catch (error) {
                    // ReconcilePayment throws on transient Paystack/network errors
                    // and on integrity violations. Both revert the payment to
                    // pending, so they are recoverable and must NOT be counted
                    // as failures. Only the "maximum retry" branch is terminal
                    // (the payment is exhausted and will not be retried this
                    // cycle); it is counted under both maxReached and
                    // terminalFailures.

                    if (error instanceof Error && error.message.includes("maximum retry")) {
                        maxReached++;
                        terminalFailures++;
                        failed++;

                        paymentLogger.error("reconciliation_max_retries_reached", {
                            event: "reconciliation_max_retries_reached",
                            reference: payment.reference,
                            error: error.message,
                        });
                    } else if (error && error.type === "transient") {
                        transientErrors++;

                        paymentLogger.error("reconciliation_payment_transient_error", {
                            event: "reconciliation_payment_transient_error",
                            reference: payment.reference,
                            error: error.message,
                        });
                    } else {
                        unexpectedErrors++;

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
                reconciled,
                alreadyVerified,
                skippedProcessing,
                deferred,
                terminalFailures,
                transientErrors,
                unexpectedErrors,
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
