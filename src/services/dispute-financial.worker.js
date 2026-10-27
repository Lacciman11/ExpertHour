/**
 * Dispute Financial Processing Worker
 *
 * Background worker that discovers resolved disputes with financial processing
 * pending and executes supported financial resolutions via disputeService.
 *
 * Design principles:
 *   1. Discovers resolved disputes eligible for financial processing.
 *   2. Uses claim/lease fencing via disputeService.claimFinancialProcessing.
 *   3. Dispatches by resolution via disputeService.processDisputeFinancialResolution.
 *   4. Uses recursive setTimeout (matching project pattern).
 *   5. No overlapping cycles.
 *   6. Configuration from environment/config.
 *   7. Clean shutdown.
 *   8. Does not retry disputes in awaiting_reconciliation.
 */

import mongoose from "mongoose";
import Dispute from "../models/Dispute.js";
import disputeService from "./dispute.service.js";
import env from "../config/env.js";
import paymentLogger from "../utils/logger.js";

const { intervalMs, batchSize, leaseMs } = env.disputeFinancial;

class DisputeFinancialWorker {
    constructor() {
        this.isRunning = false;
        this.shutdownRequested = false;
        this.timerId = null;
    }

    start() {
        if (this.isRunning) {
            paymentLogger.info("dispute_financial_worker_already_running", {
                event: "dispute_financial_worker_already_running",
            });
            return;
        }
        this.isRunning = true;
        this.shutdownRequested = false;
        paymentLogger.info("dispute_financial_worker_starting", {
            event: "dispute_financial_worker_starting",
            intervalMs,
            batchSize,
        });
        this._scheduleNext();
    }

    stop() {
        this.shutdownRequested = true;
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        this.isRunning = false;
        paymentLogger.info("dispute_financial_worker_shutdown_requested", {
            event: "dispute_financial_worker_shutdown_requested",
        });
    }

    _scheduleNext() {
        if (this.shutdownRequested) {
            this.isRunning = false;
            paymentLogger.info("dispute_financial_worker_stopped", {
                event: "dispute_financial_worker_stopped",
            });
            return;
        }
        this.timerId = setTimeout(() => {
            this._runCycle()
                .catch((error) => {
                    paymentLogger.error("dispute_financial_cycle_error", {
                        event: "dispute_financial_cycle_error",
                        error: error?.message || error,
                    });
                })
                .finally(() => {
                    this._scheduleNext();
                });
        }, intervalMs);
    }

    async _runCycle() {
        const cycleStart = Date.now();
        paymentLogger.info("dispute_financial_cycle_started", {
            event: "dispute_financial_cycle_started",
            cycleStart: new Date(cycleStart).toISOString(),
        });

        try {
            const candidates = await this._findCandidates();
            paymentLogger.info("dispute_financial_candidates_found", {
                event: "dispute_financial_candidates_found",
                count: candidates.length,
            });

            let processed = 0;
            let executed = 0;
            let claimed = 0;
            let failed = 0;

            for (const dispute of candidates) {
                if (this.shutdownRequested) {
                    paymentLogger.info("dispute_financial_shutdown_during_cycle", {
                        event: "dispute_financial_shutdown_during_cycle",
                    });
                    break;
                }

                processed++;
                try {
                    const result = await disputeService.processDisputeFinancialResolution(dispute._id, {
                        leaseMs: leaseMs || 300000,
                    });
                    if (result.claimed) {
                        claimed++;
                    }
                    if (result.applied || result.executed) {
                        executed++;
                    }
                } catch (error) {
                    failed++;
                    paymentLogger.error("dispute_financial_processing_failed", {
                        event: "dispute_financial_processing_failed",
                        disputeId: dispute._id?.toString(),
                        error: error?.message || error,
                    });
                }
            }

            const cycleDuration = Date.now() - cycleStart;
            paymentLogger.info("dispute_financial_cycle_completed", {
                event: "dispute_financial_cycle_completed",
                cycleDurationMs: cycleDuration,
                processed,
                claimed,
                executed,
                failed,
            });
        } catch (error) {
            paymentLogger.error("dispute_financial_cycle_failed", {
                event: "dispute_financial_cycle_failed",
                error: error?.message || error,
            });
        }
    }

    async _findCandidates() {
        const now = new Date();
        const supported = ["CONSULTANT_WINS", "CUSTOMER_WINS", "INCONCLUSIVE_PARTIAL_REFUND"];
        const { maxAttempts, initialRetryDelayMs, maxRetryDelayMs } = env.disputeFinancial;

        const query = {
            status: "RESOLVED",
            financialStatus: { $ne: "awaiting_reconciliation" },
            resolution: { $in: supported },
            financialAttempts: { $lt: maxAttempts },
            $or: [
                { financialStatus: { $in: [null, "none", "pending"] } },
                { financialStatus: "failed" },
                { financialStatus: "processing", financialLeaseExpiresAt: { $lt: now } },
            ],
        };

        const candidates = await Dispute.find(query)
            .sort({ updatedAt: 1 })
            .limit(batchSize * 4)
            .select("_id resolution status financialStatus financialLeaseExpiresAt financialAttempts financialClaimedAt");

        const eligible = [];
        for (const d of candidates) {
            const attempts = d.financialAttempts || 0;
            const last = d.financialClaimedAt ? new Date(d.financialClaimedAt).getTime() : null;
            if (last !== null && attempts > 0) {
                const delay = Math.min(maxRetryDelayMs, initialRetryDelayMs * Math.pow(2, attempts - 1));
                if (now.getTime() - last < delay) continue;
            }
            eligible.push(d);
            if (eligible.length >= batchSize) break;
        }
        return eligible;
    }
}

export default new DisputeFinancialWorker();
