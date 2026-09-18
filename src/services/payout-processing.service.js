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
import { createTransferRecipient, resolveBankAccount } from "./paystack-transfer.service.js";

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
     * Normalize a name for comparison:
     * - trim leading/trailing whitespace
     * - collapse repeated internal whitespace
     * - lowercase for case-insensitive comparison
     */
    static #normalizeName(name) {
        return name.trim().replace(/\s+/g, " ").toLowerCase();
    }

    /**
     * Resolve a real Paystack recipient code for a pending payout.
     *
     * Flow:
     * 1. Load ConsultantProfile by payout.consultantProfileId.
     * 2. If profile.paystackRecipientCode exists, return it.
     * 3. Validate required bank fields.
     * 4. Re-read profile to guard against concurrent recipient creation.
     * 5. Verify bank account with Paystack.
     * 6. Compare resolved account name with stored accountName.
     * 7. Call createTransferRecipient() if names match.
     * 8. Conditionally update profile only if paystackRecipientCode is still empty.
     * 9. Return the resolved code (or null on failure).
     */
    async #resolveRecipientCode(payout) {
        // 1. Load the consultant profile
        const profile = await ConsultantProfile.findById(payout.consultantProfileId);
        if (!profile) {
            paymentLogger.warn("payout_transfer_skipped_no_profile", {
                event: "payout_transfer_skipped_no_profile",
                payoutId: payout._id.toString(),
                consultantProfileId: payout.consultantProfileId?.toString(),
            });
            return null;
        }

        // 2. Reuse existing stored recipient code if available
        if (profile.paystackRecipientCode && profile.paystackRecipientCode !== "") {
            return profile.paystackRecipientCode;
        }

        // 3. Validate required fields for recipient creation
        if (!profile.accountName || !profile.accountNumber || !profile.bankCode) {
            paymentLogger.warn("payout_transfer_skipped_incomplete_profile", {
                event: "payout_transfer_skipped_incomplete_profile",
                payoutId: payout._id.toString(),
                profileId: profile._id.toString(),
                missing: {
                    accountName: !profile.accountName,
                    accountNumber: !profile.accountNumber,
                    bankCode: !profile.bankCode,
                },
            });
            return null;
        }

        // 4. Re-read profile to get latest paystackRecipientCode (concurrency safety)
        const freshProfile = await ConsultantProfile.findById(payout.consultantProfileId);
        if (freshProfile.paystackRecipientCode && freshProfile.paystackRecipientCode !== "") {
            return freshProfile.paystackRecipientCode;
        }

        // 5. Verify bank account with Paystack
        let resolvedAccountName;
        try {
            const resolution = await resolveBankAccount({
                accountNumber: profile.accountNumber,
                bankCode: profile.bankCode,
            });
            resolvedAccountName = resolution.accountName;
        } catch (error) {
            paymentLogger.error("payout_transfer_bank_resolution_failed", {
                event: "payout_transfer_bank_resolution_failed",
                payoutId: payout._id.toString(),
                profileId: profile._id.toString(),
                error: error.message,
            });
            return null;
        }

        // 6. Compare resolved account name with stored accountName
        const normalizedResolved = PayoutProcessingService.#normalizeName(resolvedAccountName);
        const normalizedStored = PayoutProcessingService.#normalizeName(profile.accountName);

        if (normalizedResolved !== normalizedStored) {
            paymentLogger.warn("payout_transfer_skipped_name_mismatch", {
                event: "payout_transfer_skipped_name_mismatch",
                payoutId: payout._id.toString(),
                profileId: profile._id.toString(),
            });
            return null;
        }

        // 7. Create transfer recipient via Paystack
        let recipientCode;
        try {
            const result = await createTransferRecipient({
                name: profile.accountName,
                accountNumber: profile.accountNumber,
                bankCode: profile.bankCode,
                currency: profile.currency || "NGN",
            });
            recipientCode = result.recipientCode;
        } catch (error) {
            paymentLogger.error("payout_transfer_recipient_creation_failed", {
                event: "payout_transfer_recipient_creation_failed",
                payoutId: payout._id.toString(),
                profileId: profile._id.toString(),
                error: error.message,
            });
            return null;
        }

        // 8. Conditional update: only write if paystackRecipientCode is still empty
        const updateResult = await ConsultantProfile.updateOne(
            { _id: profile._id, paystackRecipientCode: { $in: ["", null] } },
            { $set: { paystackRecipientCode: recipientCode } }
        );

        if (updateResult.modifiedCount === 0) {
            // Another worker won the race - fetch the existing code
            const winningProfile = await ConsultantProfile.findById(profile._id);
            return winningProfile.paystackRecipientCode;
        }

        // 9. Return the resolved code
        return recipientCode;
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
