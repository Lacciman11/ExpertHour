import mongoose from "mongoose";

import Payout from "../models/Payout.js";
import payoutService from "./payout.service.js";
import { checkTransferStatus } from "./paystack-transfer.service.js";
import { PAYOUT_STATUS } from "../utils/constants.js";
import env from "../config/env.js";
import paymentLogger from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const {
    intervalMs,
    delayMs,
    batchSize,
} = env.payoutReconciliation;

// ---------------------------------------------------------------------------
// Service Class
// ---------------------------------------------------------------------------

class PayoutReconciliationService {

    timer = null;
    isRunning = false;
    shutdownRequested = false;

    /**
     * Start the reconciliation worker.
     * Schedules the first run after the configured delay, then repeats at the interval.
     */
    start() {
        if (this.isRunning) {
            paymentLogger.info("payout_reconciliation_worker_already_running", {
                event: "payout_reconciliation_worker_already_running",
            });
            return;
        }

        this.isRunning = true;
        this.shutdownRequested = false;

        paymentLogger.info("payout_reconciliation_worker_starting", {
            event: "payout_reconciliation_worker_starting",
            intervalMs,
            delayMs,
            batchSize,
        });

        this.timer = setTimeout(() => {
            this.runCycle().finally(() => {
                this.scheduleNext();
            });
        }, delayMs);
    }

    /**
     * Request graceful shutdown.
     * The current cycle will finish, but no new cycle will start.
     */
    stop() {
        this.shutdownRequested = true;

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        paymentLogger.info("payout_reconciliation_worker_shutdown_requested", {
            event: "payout_reconciliation_worker_shutdown_requested",
        });
    }

    /**
     * Schedule the next reconciliation cycle.
     * Uses recursive setTimeout to prevent overlapping executions.
     */
    scheduleNext() {
        if (this.shutdownRequested) {
            this.isRunning = false;
            paymentLogger.info("payout_reconciliation_worker_stopped", {
                event: "payout_reconciliation_worker_stopped",
            });
            return;
        }

        this.timer = setTimeout(() => {
            this.runCycle().finally(() => {
                this.scheduleNext();
            });
        }, intervalMs);
    }

    /**
     * Execute one reconciliation cycle.
     */
    async runCycle() {
        const cycleStart = Date.now();

        paymentLogger.info("payout_reconciliation_cycle_started", {
            event: "payout_reconciliation_cycle_started",
            cycleStart: new Date(cycleStart).toISOString(),
        });

        try {
            const candidates = await this.findCandidates();

            paymentLogger.info("payout_reconciliation_candidates_found", {
                event: "payout_reconciliation_candidates_found",
                count: candidates.length,
            });

            let processed = 0;
            let completed = 0;
            let failed = 0;
            let skipped = 0;

            for (const payout of candidates) {
                if (this.shutdownRequested) {
                    paymentLogger.info("payout_reconciliation_shutdown_during_cycle", {
                        event: "payout_reconciliation_shutdown_during_cycle",
                    });
                    break;
                }

                processed++;

                try {
                    const result = await this.reconcilePayout(payout);

                    if (result === "completed") {
                        completed++;
                        paymentLogger.info("payout_reconciliation_completed", {
                            event: "payout_reconciliation_completed",
                            payoutId: payout._id.toString(),
                        });
                    } else if (result === "failed") {
                        failed++;
                        paymentLogger.info("payout_reconciliation_failed", {
                            event: "payout_reconciliation_failed",
                            payoutId: payout._id.toString(),
                        });
                    } else {
                        skipped++;
                        paymentLogger.info("payout_reconciliation_skipped", {
                            event: "payout_reconciliation_skipped",
                            payoutId: payout._id.toString(),
                            reason: result,
                        });
                    }
                } catch (error) {
                    skipped++;
                    paymentLogger.error("payout_reconciliation_error", {
                        event: "payout_reconciliation_error",
                        payoutId: payout._id.toString(),
                        error: error.message,
                    });
                }
            }

            const cycleDuration = Date.now() - cycleStart;

            paymentLogger.info("payout_reconciliation_cycle_completed", {
                event: "payout_reconciliation_cycle_completed",
                cycleDurationMs: cycleDuration,
                processed,
                completed,
                failed,
                skipped,
            });

        } catch (error) {
            paymentLogger.error("payout_reconciliation_cycle_failed", {
                event: "payout_reconciliation_cycle_failed",
                error: error.message,
            });
        }
    }

    /**
     * Find PROCESSING payouts eligible for reconciliation.
     *
     * Eligible payouts:
     * 1. status === PROCESSING
     * 2. paystackTransferReference is not null/empty
     *
     * NOT eligible:
     * - PENDING, COMPLETED, FAILED payouts
     * - PROCESSING payouts without a transfer reference
     */
    async findCandidates() {
        return await Payout.find({
            status: PAYOUT_STATUS.PROCESSING,
            paystackTransferReference: { $nin: [null, ""] },
        })
            .sort({ initiatedAt: 1 })
            .limit(batchSize)
            .lean();
    }

    /**
     * Reconcile a single PROCESSING payout by checking its Paystack transfer status.
     *
     * @param {object} payout - The payout document (lean)
     * @returns {Promise<string>} "completed", "failed", or skip reason
     */
    async reconcilePayout(payout) {
        // Use transfer reference if available, otherwise fall back to transfer code
        const identifier = payout.paystackTransferReference || payout.paystackTransferCode;

        if (!identifier) {
            return "no_identifier";
        }

        let transferResult;
        try {
            transferResult = await checkTransferStatus(identifier);
        } catch (error) {
            // Network error, timeout, or ambiguous error
            // Leave payout as PROCESSING and retry on next cycle
            paymentLogger.error("payout_reconciliation_status_check_failed", {
                event: "payout_reconciliation_status_check_failed",
                payoutId: payout._id.toString(),
                identifier,
                error: error.message,
            });
            return "status_check_failed";
        }

        // Malformed or ambiguous response
        if (!transferResult || !transferResult.status) {
            paymentLogger.warn("payout_reconciliation_malformed_response", {
                event: "payout_reconciliation_malformed_response",
                payoutId: payout._id.toString(),
                identifier,
                transferResult,
            });
            return "malformed_response";
        }

        const paystackStatus = transferResult.status.toLowerCase();

        if (paystackStatus === "success") {
            // Paystack confirms success → mark as COMPLETED
            await payoutService.markPayoutAsCompleted(payout._id.toString());
            return "completed";
        }

        if (paystackStatus === "failed") {
            // Paystack confirms failure → mark as FAILED
            await payoutService.markPayoutAsFailed(
                payout._id.toString(),
                `Paystack transfer failed: ${transferResult.status}`
            );
            return "failed";
        }

        // Any other status (pending, processing, reversed, etc.) → remain PROCESSING
        paymentLogger.info("payout_reconciliation_transfer_pending", {
            event: "payout_reconciliation_transfer_pending",
            payoutId: payout._id.toString(),
            identifier,
            paystackStatus,
        });
        return "transfer_pending";
    }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export { PayoutReconciliationService };
export default new PayoutReconciliationService();
