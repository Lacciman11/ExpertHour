import mongoose from "mongoose";
import Payment from "../models/Payment.js";
import refundService from "./refund.service.js";
import env from "../config/env.js";
import paymentLogger from "../utils/logger.js";

const {
    intervalMs,
    delayMs,
    batchSize,
} = env.refundReconciliation;

/**
 * RefundReconciliationService
 *
 * Recovery orchestrator for Paystack refunds that succeeded externally but
 * whose local MongoDB transaction failed to commit.
 *
 * This service does NOT duplicate reconciliation logic.
 * It delegates all financial decisions to refundService.reconcileRefundWithPaystack().
 *
 * Scenario: processRefundWithPaystack() calls Paystack (which succeeds),
 * then attempts a local DB transaction. If that transaction fails, the
 * Payment row still has refundStatus="pending" and refundReference set
 * (saved before the transaction), but the ConsultantEarning/Booking state
 * was never updated.
 *
 * This worker finds such payments and reconciles them with the external
 * Paystack refund state.
 */
class RefundReconciliationService {

    constructor() {

        this.isRunning = false;

        this.shutdownRequested = false;

        this.timerId = null;

    }

    /**
     * Start the refund reconciliation worker.
     * Must be called after MongoDB connection is established.
     */
    start() {

        if (this.isRunning) {

            paymentLogger.info("refund_reconciliation_worker_already_running", {

                event: "refund_reconciliation_worker_already_running",

            });

            return;

        }

        this.isRunning = true;

        this.shutdownRequested = false;

        paymentLogger.info("refund_reconciliation_worker_starting", {

            event: "refund_reconciliation_worker_starting",

            intervalMs,

            delayMs,

            batchSize,

        });

        this._scheduleNext();

    }

    /**
     * Manually trigger a refund reconciliation cycle.
     * Useful for admin-triggered processing or testing.
     * @returns {Promise<object>} Processing results
     */
    async processNow() {
        if (this.isRunning) {
            throw new Error("Refund reconciliation is already in progress");
        }

        this.isRunning = true;

        try {
            return await this._runCycle();
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Request graceful shutdown.
     * The current cycle will finish, but no new cycle will start.
     */
    stop() {

        this.shutdownRequested = true;

        this.isRunning = false;

        if (this.timerId) {

            clearTimeout(this.timerId);

            this.timerId = null;

        }

        paymentLogger.info("refund_reconciliation_worker_shutdown_requested", {

            event: "refund_reconciliation_worker_shutdown_requested",

        });

    }

    /**
     * Schedule the next reconciliation cycle.
     * Uses recursive setTimeout to prevent overlapping executions.
     */
    _scheduleNext() {

        if (this.shutdownRequested) {

            this.isRunning = false;

            paymentLogger.info("refund_reconciliation_worker_stopped", {

                event: "refund_reconciliation_worker_stopped",

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

        paymentLogger.info("refund_reconciliation_cycle_started", {

            event: "refund_reconciliation_cycle_started",

            cycleStart: new Date(cycleStart).toISOString(),

        });

        try {

            const candidates = await this._findCandidates();

            paymentLogger.info("refund_reconciliation_candidates_found", {

                event: "refund_reconciliation_candidates_found",

                count: candidates.length,

            });

            let processed = 0;

            let reconciled = 0;

            let failed = 0;

            for (const payment of candidates) {

                if (this.shutdownRequested) {

                    paymentLogger.info("refund_reconciliation_shutdown_during_cycle", {

                        event: "refund_reconciliation_shutdown_during_cycle",

                    });

                    break;

                }

                processed++;

                // Persist attempt count and timestamp atomically before processing.
                await Payment.updateOne(
                    { _id: payment._id },
                    { $inc: { reconciliationAttempts: 1 }, $set: { lastReconciliationAttemptAt: new Date() } }
                );

                try {

                    const result = await refundService.reconcileRefundWithPaystack(payment._id);

                    if (result.reconciled) {
                        try {
                            const disputeService = (await import("./dispute.service.js")).default;
                            await disputeService.finalizeDisputeFromReconciliation(payment.refundReference);
                        } catch (err) {
                            // ignore
                        }

                        reconciled++;

                        paymentLogger.info("refund_reconciliation_payment_reconciled", {

                            event: "refund_reconciliation_payment_reconciled",

                            paymentId: payment._id.toString(),

                            paystackStatus: result.paystackStatus,

                        });

                    }

                } catch (error) {

                    failed++;

                    paymentLogger.error("refund_reconciliation_payment_error", {

                        event: "refund_reconciliation_payment_error",

                        paymentId: payment._id.toString(),

                        error: error.message,

                    });

                }

            }

            const cycleDuration = Date.now() - cycleStart;

            paymentLogger.info("refund_reconciliation_cycle_completed", {

                event: "refund_reconciliation_cycle_completed",

                cycleDurationMs: cycleDuration,

                processed,

                reconciled,

                failed,

            });

            return {

                processed,

                reconciled,

                failed,

            };

        } catch (error) {

            paymentLogger.error("refund_reconciliation_cycle_failed", {

                event: "refund_reconciliation_cycle_failed",

                error: error.message,

            });

            return {

                processed: 0,

                reconciled: 0,

                failed: 0,

                error: error.message,

            };

        }

    }

    /**
     * Find payments eligible for refund reconciliation.
     *
     * Eligible payments:
     * - refundStatus: "pending" (local transaction did not complete)
     * - refundReference is set (external refund was initiated)
     *
     * These are payments where processRefundWithPaystack() called Paystack
     * successfully but the local MongoDB transaction failed.
     */
    async _findCandidates() {
        const { maxAttempts, initialRetryDelayMs, maxRetryDelayMs } = env.refundReconciliation;
        const now = Date.now();

        const payments = await Payment.find({
            refundStatus: "pending",
            refundReference: { $ne: "", $exists: true },
        })
            .sort({ updatedAt: 1 })
            .limit(batchSize * 4)
            .lean();

        const eligible = [];
        for (const p of payments) {
            const attempts = p.reconciliationAttempts || 0;
            if (attempts >= maxAttempts) continue;
            const last = p.lastReconciliationAttemptAt ? new Date(p.lastReconciliationAttemptAt).getTime() : null;
            if (last !== null) {
                const delay = Math.min(maxRetryDelayMs, initialRetryDelayMs * Math.pow(2, attempts));
                if (now - last < delay) continue;
            }
            eligible.push(p);
            if (eligible.length >= batchSize) break;
        }
        return eligible;
    }

}

export default new RefundReconciliationService();
