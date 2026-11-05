/**
 * Payout Processing Service
 *
 * Background worker that periodically processes payout cycles for all consultants.
 * Follows the same pattern as PaymentReconciliationService and EarningEligibilityService.
 *
 * Responsibilities:
 * - Find eligible earnings for the current payout cycle
 * - Group earnings by consultant
 * - Create payouts for consultants meeting the minimum threshold
 * - Carry forward earnings below threshold
 * - Handle failures gracefully
 * - Provide idempotent processing
 */

import mongoose from "mongoose";

import payoutService from "./payout.service.js";
import Payout from "../models/Payout.js";
import ConsultantProfile from "../models/ConsultantProfile.js";
import { EARNING_STATUS, PAYOUT_STATUS } from "../utils/constants.js";
import env from "../config/env.js";
import paymentLogger from "../utils/logger.js";
import consultantProfileService from "./consultant-profile.service.js";

// ---------------------------------------------------------------------------
// Export class for testing
// ---------------------------------------------------------------------------

export { PayoutProcessingService };

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const {
    intervalMs,
    delayMs,
    processingTimeoutMs,
    maxAttempts,
    batchSize,
} = env.payoutProcessing;

// ---------------------------------------------------------------------------
// Service Class
// ---------------------------------------------------------------------------

class PayoutProcessingService {

    #config;
    #timer = null;
    #isRunning = false;
    #processingStartTime = null;

    /**
     * Create a new PayoutProcessingService instance.
     * @param {object} config - Configuration overrides
     */
    constructor(config = {}) {
        this.#config = {
            intervalMs,
            delayMs,
            processingTimeoutMs,
            maxAttempts,
            batchSize,
            ...config,
        };
    }

    /**
     * Start the background worker.
     * Schedules the first run after the configured delay, then repeats at the interval.
     */
    start() {
        if (this.#timer) {
            console.log("[PayoutProcessing] Worker already running");
            return;
        }

        console.log(
            `[PayoutProcessing] Worker starting in ${this.#config.delayMs}ms, ` +
            `interval=${this.#config.intervalMs}ms, batchSize=${this.#config.batchSize}`
        );

        this.#timer = setTimeout(() => {
            this.#runCycle().finally(() => {
                this.#scheduleNext();
            });
        }, this.#config.delayMs);
    }

    /**
     * Stop the background worker.
     * Prevents new cycles from starting.
     */
    stop() {
        if (this.#timer) {
            clearTimeout(this.#timer);
            this.#timer = null;
            console.log("[PayoutProcessing] Worker shutdown requested");
        }
    }

    /**
     * Check if the worker is currently running.
     * @returns {boolean} True if a cycle is in progress
     */
    get isRunning() {
        return this.#isRunning;
    }

    /**
     * Schedule the next cycle.
     */
    #scheduleNext() {
        if (this.#timer) {
            this.#timer = setTimeout(() => {
                this.#runCycle().finally(() => {
                    this.#scheduleNext();
                });
            }, this.#config.intervalMs);
        }
    }

    /**
     * Run a single payout processing cycle.
     * Finds eligible earnings and processes them in batches.
     */
    async #runCycle() {
        // Prevent overlapping cycles
        if (this.#isRunning) {
            console.log("[PayoutProcessing] Cycle already running, skipping");
            return;
        }

        this.#isRunning = true;
        this.#processingStartTime = Date.now();

        console.log("[PayoutProcessing] Starting payout processing cycle");

        try {
            // 1. Create payouts from eligible earnings
            const cycleResult = await payoutService.processPayoutCycle(null, {
                batchSize: this.#config.batchSize,
            });

            console.log(
                `[PayoutProcessing] Cycle completed: ` +
                `processed=${cycleResult.processed}, ` +
                `created=${cycleResult.created}, ` +
                `carriedForward=${cycleResult.carriedForward}`
            );

            // 2. Initiate Paystack transfers for any PENDING payouts
            const transferResult = await this.#processPendingTransfers();

            return {
                ...cycleResult,
                transfersInitiated: transferResult.initiated,
                transfersFailed: transferResult.failed,
                transfersSkipped: transferResult.skipped,
            };
        } catch (error) {
            console.error("[PayoutProcessing] Cycle failed:", error);
            throw error;
        } finally {
            this.#isRunning = false;
            this.#processingStartTime = null;
        }
    }

    /**
     * Initiate Paystack transfers for all PENDING payouts.
     * Skips payouts already in PROCESSING, COMPLETED, or FAILED state.
     */
    async #processPendingTransfers() {
        const pendingPayouts = await Payout.find({ status: PAYOUT_STATUS.PENDING });

        let initiated = 0;
        let failed = 0;
        let skipped = 0;

        for (const payout of pendingPayouts) {
            try {
                // Resolve a real recipient code if currently placeholder
                if (!payout.transferRecipientCode || payout.transferRecipientCode === "RCP_PENDING") {
                    const recipientCode = await this.#resolveRecipientCode(payout);
                    if (!recipientCode) {
                        skipped++;
                        continue;
                    }
                    payout.transferRecipientCode = recipientCode;
                    await payout.save();
                }

                await payoutService.initiatePayoutTransfer(
                    payout._id.toString(),
                    payout.transferRecipientCode
                );

                initiated++;
            } catch (error) {
                paymentLogger.error("payout_transfer_failed", {
                    event: "payout_transfer_failed",
                    payoutId: payout._id.toString(),
                    error: error.message,
                });

                // If the payout was explicitly marked as FAILED by initiatePayoutTransfer,
                // count it as failed. Otherwise, it's still PENDING and will be retried.
                const updatedPayout = await Payout.findById(payout._id);
                if (updatedPayout.status === PAYOUT_STATUS.FAILED) {
                    failed++;
                }
                // For ambiguous errors, the payout remains PENDING and will be retried
            }
        }

        return { initiated, failed, skipped };
    }

    /**
     * Resolve a real Paystack recipient code for a pending payout.
     *
     * Delegates to the shared recipient-resolution operation in
     * ConsultantProfileService.resolvePaystackRecipient(). Returns null on
     * any failure so the payout is skipped and retried on the next cycle.
     *
     * @param {object} payout - The Payout document
     * @returns {Promise<string|null>} The recipient code, or null if resolution failed
     */
    async #resolveRecipientCode(payout) {
        // Load the consultant profile to get the userId
        const profile = await ConsultantProfile.findById(payout.consultantProfileId);
        if (!profile) {
            paymentLogger.warn("payout_transfer_skipped_no_profile", {
                event: "payout_transfer_skipped_no_profile",
                payoutId: payout._id.toString(),
                consultantProfileId: payout.consultantProfileId?.toString(),
            });
            return null;
        }

        // Use the shared recipient resolution operation
        try {
            const result = await consultantProfileService.resolvePaystackRecipient(profile.userId);
            return result.recipientCode;
        } catch (error) {
            paymentLogger.error("payout_transfer_recipient_resolution_failed", {
                event: "payout_transfer_recipient_resolution_failed",
                payoutId: payout._id.toString(),
                profileId: profile._id.toString(),
                error: error.message,
            });
            return null;
        }
    }

    /**
     * Manually trigger a payout processing cycle.
     * Useful for admin-triggered processing or testing.
     * @param {Date} cycleEndDate - Optional cycle end date
     * @returns {Promise<object>} Processing results
     */
    async processNow(cycleEndDate = null) {
        if (this.#isRunning) {
            throw new Error("Payout processing is already in progress");
        }

        this.#isRunning = true;
        this.#processingStartTime = Date.now();

        try {
            const cycleResult = await payoutService.processPayoutCycle(cycleEndDate, {
                batchSize: this.#config.batchSize,
            });

            console.log(
                `[PayoutProcessing] Manual cycle completed: ` +
                `processed=${cycleResult.processed}, ` +
                `created=${cycleResult.created}, ` +
                `carriedForward=${cycleResult.carriedForward}`
            );

            // Initiate transfers for any PENDING payouts
            const transferResult = await this.#processPendingTransfers();

            return {
                ...cycleResult,
                transfersInitiated: transferResult.initiated,
                transfersFailed: transferResult.failed,
                transfersSkipped: transferResult.skipped,
            };
        } finally {
            this.#isRunning = false;
            this.#processingStartTime = null;
        }
    }

    /**
     * Get the current processing status.
     * @returns {object} Status information
     */
    getStatus() {
        return {
            isRunning: this.#isRunning,
            processingStartTime: this.#processingStartTime,
            processingDurationMs: this.#processingStartTime
                ? Date.now() - this.#processingStartTime
                : null,
            config: { ...this.#config },
        };
    }
}

// ---------------------------------------------------------------------------
// Export Singleton
// ---------------------------------------------------------------------------

export default new PayoutProcessingService();
