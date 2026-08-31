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
import { EARNING_STATUS, PAYOUT_STATUS } from "../utils/constants.js";

// ---------------------------------------------------------------------------
// Export class for testing
// ---------------------------------------------------------------------------

export { PayoutProcessingService };

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
    intervalMs: 60 * 60 * 1000, // 1 hour
    delayMs: 5 * 60 * 1000, // 5 minutes initial delay
    processingTimeoutMs: 10 * 60 * 1000, // 10 minutes max processing time
    maxAttempts: 3,
    batchSize: 20,
};

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
        this.#config = { ...DEFAULT_CONFIG, ...config };
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
            const result = await payoutService.processPayoutCycle(null, {
                batchSize: this.#config.batchSize,
            });

            console.log(
                `[PayoutProcessing] Cycle completed: ` +
                `processed=${result.processed}, ` +
                `created=${result.created}, ` +
                `carriedForward=${result.carriedForward}`
            );

            return result;
        } catch (error) {
            console.error("[PayoutProcessing] Cycle failed:", error);
            throw error;
        } finally {
            this.#isRunning = false;
            this.#processingStartTime = null;
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
            const result = await payoutService.processPayoutCycle(cycleEndDate, {
                batchSize: this.#config.batchSize,
            });

            console.log(
                `[PayoutProcessing] Manual cycle completed: ` +
                `processed=${result.processed}, ` +
                `created=${result.created}, ` +
                `carriedForward=${result.carriedForward}`
            );

            return result;
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
