import mongoose from "mongoose";

import Payout from "../models/Payout.js";
import ConsultantEarning from "../models/ConsultantEarning.js";
import ConsultantProfile from "../models/ConsultantProfile.js";
import ApiError from "../utils/ApiError.js";
import {
    EARNING_STATUS,
    PAYOUT_STATUS,
    HOLD_REASON,
    MINIMUM_PAYOUT_KOBO,
} from "../utils/constants.js";
import { initiateTransfer } from "../services/paystack-transfer.service.js";

// ---------------------------------------------------------------------------
// Payable Amount Helpers
// ---------------------------------------------------------------------------

/**
 * Get the payable gross amount for an earning.
 * Uses adjusted value when adjustment exists, otherwise original.
 * @param {object} earning - The ConsultantEarning document
 * @returns {number} Payable gross amount in kobo
 */
function getPayableGrossAmount(earning) {
    return earning.adjustedGrossAmount !== null && earning.adjustedGrossAmount !== undefined
        ? earning.adjustedGrossAmount
        : earning.grossAmount;
}

/**
 * Get the payable commission amount for an earning.
 * Uses adjusted value when adjustment exists, otherwise original.
 * @param {object} earning - The ConsultantEarning document
 * @returns {number} Payable commission amount in kobo
 */
function getPayableCommissionAmount(earning) {
    return earning.adjustedPlatformCommission !== null && earning.adjustedPlatformCommission !== undefined
        ? earning.adjustedPlatformCommission
        : earning.platformCommission;
}

/**
 * Get the payable consultant amount for an earning.
 * Uses adjusted value when adjustment exists, otherwise original.
 * @param {object} earning - The ConsultantEarning document
 * @returns {number} Payable consultant amount in kobo
 */
function getPayableConsultantAmount(earning) {
    return earning.adjustedConsultantEntitlement !== null && earning.adjustedConsultantEntitlement !== undefined
        ? earning.adjustedConsultantEntitlement
        : earning.consultantEntitlement;
}

// ---------------------------------------------------------------------------
// Payout Cycle Helpers
// ---------------------------------------------------------------------------

/**
 * Get the last day of a given month.
 * @param {number} year - The year
 * @param {number} month - The month (0-indexed)
 * @returns {number} The last day of the month
 */
function getLastDayOfMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
}

/**
 * Determine the payout cycle for a given date.
 * Biweekly: 1st-15th and 16th-last day of month.
 * Uses UTC to avoid timezone issues.
 * @param {Date} date - The date to determine the cycle for
 * @returns {object} Cycle start date, end date, and label
 */
function getPayoutCycleForDate(date) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();

    let cycleStartDate;
    let cycleEndDate;
    let cycleLabel;

    if (day <= 15) {
        // First half of month: 1st-15th
        cycleStartDate = new Date(Date.UTC(year, month, 1));
        cycleEndDate = new Date(Date.UTC(year, month, 15, 23, 59, 59, 999));
        cycleLabel = `${year}-${String(month + 1).padStart(2, "0")}-15`;
    } else {
        // Second half of month: 16th-last day
        const lastDay = getLastDayOfMonth(year, month);
        cycleStartDate = new Date(Date.UTC(year, month, 16));
        cycleEndDate = new Date(Date.UTC(year, month, lastDay, 23, 59, 59, 999));
        cycleLabel = `${year}-${String(month + 1).padStart(2, "0")}-${lastDay}`;
    }

    return { cycleStartDate, cycleEndDate, cycleLabel };
}

/**
 * Get the current payout cycle.
 * @returns {object} Cycle start date, end date, and label
 */
function getCurrentPayoutCycle() {
    return getPayoutCycleForDate(new Date());
}

// ---------------------------------------------------------------------------
// Payout Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate payout totals from eligible earnings.
 * @param {Array} eligibleEarnings - Array of ConsultantEarning documents
 * @returns {object} Payout calculation results
 */
function calculatePayout(eligibleEarnings) {
    let payableGrossAmount = 0;
    let payableCommission = 0;
    let payableConsultantAmount = 0;

    for (const earning of eligibleEarnings) {
        payableGrossAmount += getPayableGrossAmount(earning);
        payableCommission += getPayableCommissionAmount(earning);
        payableConsultantAmount += getPayableConsultantAmount(earning);
    }

    return {
        grossAmount: payableGrossAmount,
        totalCommission: payableCommission,
        netAmount: payableConsultantAmount,
        earningCount: eligibleEarnings.length,
        earningIds: eligibleEarnings.map(e => e._id),
    };
}

// ---------------------------------------------------------------------------
// Service Class
// ---------------------------------------------------------------------------

class PayoutService {

    /**
     * Find eligible earnings for a consultant that can be included in a payout.
     * 
     * @param {string} consultantId - The consultant ID
     * @param {Date} cycleEndDate - The cycle end date
     * @returns {Promise<Array>} Array of eligible ConsultantEarning documents
     */
    async findEligibleEarnings(consultantId, cycleEndDate) {
        const earnings = await ConsultantEarning.find({
            consultantId,
            status: EARNING_STATUS.ELIGIBLE,
            eligibleAt: { $lte: cycleEndDate },
            payoutId: null,
        }).sort({ eligibleAt: 1 });

        return earnings;
    }

    /**
     * Check if the payable amount meets the minimum payout threshold.
     * 
     * @param {Array} eligibleEarnings - Array of ConsultantEarning documents
     * @returns {object} Threshold check result
     */
    checkMinimumThreshold(eligibleEarnings) {
        const payableConsultantAmount = eligibleEarnings.reduce(
            (sum, e) => sum + getPayableConsultantAmount(e),
            0
        );

        return {
            meetsThreshold: payableConsultantAmount >= MINIMUM_PAYOUT_KOBO,
            payableConsultantAmount,
            minimumRequired: MINIMUM_PAYOUT_KOBO,
        };
    }

    /**
     * Create a payout for a consultant.
     * 
     * @param {string} consultantId - The consultant ID
     * @param {Date} cycleEndDate - The cycle end date (optional, defaults to current cycle)
     * @returns {Promise<object>} The created payout or threshold not met result
     * @throws {ApiError} If consultant not found or payout creation fails
     */
    async createPayout(consultantId, cycleEndDate = null) {
        // Get the payout cycle
        const cycle = cycleEndDate
            ? getPayoutCycleForDate(cycleEndDate)
            : getCurrentPayoutCycle();

        // Verify consultant exists
        const consultantProfile = await ConsultantProfile.findOne({ userId: consultantId });
        if (!consultantProfile) {
            throw new ApiError(404, "Consultant profile not found");
        }

        // Start a session for transaction support
        const mongoSession = await mongoose.startSession();

        try {
            const result = await mongoSession.withTransaction(async () => {
                // 1. Check for existing payout for this consultant and cycle
                const existingPayout = await Payout.findOne({
                    consultantId,
                    cycleLabel: cycle.cycleLabel,
                }).session(mongoSession);

                if (existingPayout) {
                    return { payout: existingPayout, created: false, duplicate: true };
                }

                // 2. Find eligible earnings
                const eligibleEarnings = await this.findEligibleEarnings(
                    consultantId,
                    cycle.cycleEndDate
                );

                if (eligibleEarnings.length === 0) {
                    return {
                        payout: null,
                        created: false,
                        reason: "No eligible earnings found",
                    };
                }

                // 3. Check minimum threshold
                const thresholdCheck = this.checkMinimumThreshold(eligibleEarnings);
                if (!thresholdCheck.meetsThreshold) {
                    // Mark earnings with hold reason for carry-forward
                    const earningIds = eligibleEarnings.map(e => e._id);
                    await ConsultantEarning.updateMany(
                        { _id: { $in: earningIds } },
                        {
                            $set: {
                                holdReason: HOLD_REASON.PAYOUT_THRESHOLD_NOT_MET,
                            },
                        }
                    );

                    return {
                        payout: null,
                        created: false,
                        reason: "Minimum payout threshold not met",
                        payableConsultantAmount: thresholdCheck.payableConsultantAmount,
                        minimumRequired: thresholdCheck.minimumRequired,
                    };
                }

                // 4. Calculate payout totals
                const payoutCalculation = calculatePayout(eligibleEarnings);

                // 4a. Apply recovery offset for post-payout refund obligations
                const totalOutstandingRecovery = await ConsultantEarning.getTotalOutstandingRecovery(
                    consultantId,
                    mongoSession
                );
                const recoveryOffset = Math.min(
                    totalOutstandingRecovery,
                    payoutCalculation.netAmount
                );
                const adjustedNetAmount = payoutCalculation.netAmount - recoveryOffset;

                if (recoveryOffset > 0) {
                    await ConsultantEarning.applyRecoveryOffset(
                        consultantId,
                        recoveryOffset,
                        mongoSession
                    );
                }

                // 5. Create the payout
                // Note: transferRecipientCode is required by the model but will be updated
                // during Paystack integration. We use a placeholder for now.
                const [payout] = await Payout.create([{
                    consultantId,
                    consultantProfileId: consultantProfile._id,
                    cycleStartDate: cycle.cycleStartDate,
                    cycleEndDate: cycle.cycleEndDate,
                    cycleLabel: cycle.cycleLabel,
                    earningIds: payoutCalculation.earningIds,
                    earningCount: payoutCalculation.earningCount,
                    grossAmount: payoutCalculation.grossAmount,
                    totalCommission: payoutCalculation.totalCommission,
                    netAmount: adjustedNetAmount,
                    recoveryOffset: recoveryOffset,
                    status: PAYOUT_STATUS.PENDING,
                    transferRecipientCode: "RCP_PENDING", // Placeholder, updated during Paystack integration
                }], { session: mongoSession });

                // 6. Update earnings to IN_PAYOUT status
                const earningIds = eligibleEarnings.map(e => e._id);
                await ConsultantEarning.updateMany(
                    { _id: { $in: earningIds } },
                    {
                        $set: {
                            status: EARNING_STATUS.IN_PAYOUT,
                            payoutId: payout._id,
                        },
                        $push: {
                            statusHistory: {
                                from: EARNING_STATUS.ELIGIBLE,
                                to: EARNING_STATUS.IN_PAYOUT,
                                changedAt: new Date(),
                                reason: `Included in payout ${payout._id}`,
                            },
                        },
                    },
                    { session: mongoSession }
                );

                return { payout, created: true, duplicate: false };
            });

            return result;
        } catch (error) {
            // Handle duplicate key error (idempotency - concurrent request)
            if (error.code === 11000) {
                // Another request created the payout, fetch and return it
                const existingPayout = await Payout.findOne({
                    consultantId,
                    cycleLabel: cycle.cycleLabel,
                });
                if (existingPayout) {
                    return { payout: existingPayout, created: false, duplicate: true };
                }
            }

            // Re-throw ApiError instances
            if (error instanceof ApiError) {
                throw error;
            }

            // Wrap other errors
            throw new ApiError(500, `Failed to create payout: ${error.message}`);
        } finally {
            mongoSession.endSession();
        }
    }

    /**
     * Get a payout by ID.
     * @param {string} payoutId - The payout ID
     * @returns {Promise<object>} The payout
     * @throws {ApiError} If payout not found
     */
    async getPayoutById(payoutId) {
        const payout = await Payout.findById(payoutId);

        if (!payout) {
            throw new ApiError(404, "Payout not found");
        }

        return payout;
    }

    /**
     * Get payouts by consultant ID.
     * @param {string} consultantId - The consultant ID
     * @param {string} status - Optional status filter
     * @returns {Promise<Array>} Array of payouts
     */
    async getPayoutsByConsultantId(consultantId, status = null) {
        const query = { consultantId };

        if (status) {
            query.status = status;
        }

        const payouts = await Payout.find(query).sort({ createdAt: -1 });

        return payouts;
    }

    /**
     * Get all payouts (admin).
     * @param {object} options - Query options
     * @param {string} [options.status] - Optional status filter
     * @param {string} [options.page] - Page number
     * @param {string} [options.limit] - Items per page
     * @returns {Promise<object>} Paginated results
     */
    async getAllPayouts({ status, page, limit } = {}) {
        const query = {};

        if (status) {
            query.status = status;
        }

        const pageNum = page ? parseInt(page, 10) : 1;
        const limitNum = limit ? parseInt(limit, 10) : 20;
        const skip = (pageNum - 1) * limitNum;

        const [payouts, total] = await Promise.all([
            Payout.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
            Payout.countDocuments(query),
        ]);

        return {
            payouts,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                pages: Math.ceil(total / limitNum),
            },
        };
    }

    /**
     * Check if a payout exists for a consultant and cycle.
     * @param {string} consultantId - The consultant ID
     * @param {string} cycleLabel - The cycle label
     * @returns {Promise<boolean>} True if payout exists
     */
    async payoutExists(consultantId, cycleLabel) {
        const count = await Payout.countDocuments({ consultantId, cycleLabel });
        return count > 0;
    }

    // -----------------------------------------------------------------------
    // Payout Cycle Processing
    // -----------------------------------------------------------------------

    /**
     * Process a payout cycle for all consultants.
     * Groups eligible earnings by consultant, creates payouts for those meeting
     * the minimum threshold, and carries forward earnings below threshold.
     *
     * Uses atomic claiming to prevent concurrent workers from processing the
     * same earnings. Processes consultants in batches to limit memory usage.
     *
     * @param {Date} cycleEndDate - The cycle end date
     * @param {object} options - Processing options
     * @param {number} [options.batchSize=20] - Number of consultants to process per batch
     * @returns {Promise<object>} Processing results
     */
    async processPayoutCycle(cycleEndDate = null, options = {}) {
        const cycle = cycleEndDate
            ? getPayoutCycleForDate(cycleEndDate)
            : getCurrentPayoutCycle();

        const batchSize = options.batchSize || 20;

        // Find all eligible earnings for this cycle
        // Sort by consultantId to enable batching
        const eligibleEarnings = await ConsultantEarning.find({
            status: EARNING_STATUS.ELIGIBLE,
            eligibleAt: { $lte: cycle.cycleEndDate },
            payoutId: null,
        }).sort({ consultantId: 1, eligibleAt: 1 });

        if (eligibleEarnings.length === 0) {
            return {
                processed: 0,
                created: 0,
                carriedForward: 0,
                results: [],
            };
        }

        // Group earnings by consultant
        const earningsByConsultant = new Map();
        for (const earning of eligibleEarnings) {
            const key = earning.consultantId.toString();
            if (!earningsByConsultant.has(key)) {
                earningsByConsultant.set(key, []);
            }
            earningsByConsultant.get(key).push(earning);
        }

        // Convert to array for batching
        const consultantEntries = Array.from(earningsByConsultant.entries());
        const results = [];
        let createdCount = 0;
        let carriedForwardCount = 0;

        // Process in batches
        for (let i = 0; i < consultantEntries.length; i += batchSize) {
            const batch = consultantEntries.slice(i, i + batchSize);

            // Process each consultant in the batch
            for (const [consultantId, earnings] of batch) {
                try {
                    // Use createPayout which handles atomic claiming via transaction
                    const payoutResult = await this.createPayout(consultantId, cycle.cycleEndDate);

                    if (payoutResult.created) {
                        results.push({
                            consultantId,
                            action: "created",
                            payout: payoutResult.payout,
                            earningsCount: earnings.length,
                        });
                        createdCount++;
                    } else if (payoutResult.duplicate) {
                        results.push({
                            consultantId,
                            action: "duplicate",
                            payout: payoutResult.payout,
                            earningsCount: earnings.length,
                        });
                    } else {
                        // No eligible earnings or threshold not met
                        results.push({
                            consultantId,
                            action: payoutResult.reason === "Minimum payout threshold not met"
                                ? "carried_forward"
                                : "skipped",
                            reason: payoutResult.reason,
                            payableAmount: payoutResult.payableConsultantAmount,
                            minimumRequired: payoutResult.minimumRequired,
                            earningsCount: earnings.length,
                        });
                        if (payoutResult.reason === "Minimum payout threshold not met") {
                            carriedForwardCount++;
                        }
                    }
                } catch (error) {
                    // Log error but continue processing other consultants
                    results.push({
                        consultantId,
                        action: "error",
                        error: error.message,
                        earningsCount: earnings.length,
                    });
                }
            }
        }

        return {
            processed: eligibleEarnings.length,
            created: createdCount,
            carriedForward: carriedForwardCount,
            results,
        };
    }

    // -----------------------------------------------------------------------
    // Payout Status Transitions
    // -----------------------------------------------------------------------

    /**
     * Mark a payout as processing (Paystack transfer initiated).
     * @param {string} payoutId - The payout ID
     * @param {string} transferReference - The Paystack transfer reference
     * @returns {Promise<object>} The updated payout
     * @throws {ApiError} If payout not found or not in PENDING status
     */
    async markPayoutAsProcessing(payoutId, transferReference) {
        const payout = await Payout.findById(payoutId);

        if (!payout) {
            throw new ApiError(404, "Payout not found");
        }

        if (payout.status !== PAYOUT_STATUS.PENDING) {
            throw new ApiError(400, `Cannot process payout in ${payout.status} status`);
        }

        payout.status = PAYOUT_STATUS.PROCESSING;
        payout.paystackTransferReference = transferReference;
        payout.initiatedAt = new Date();

        await payout.save();

        return payout;
    }

    /**
     * Initiate a Paystack transfer for a PENDING payout.
     *
     * Generates a deterministic transfer reference from the payout ID,
     * calls Paystack to initiate the transfer, and marks the payout as PROCESSING.
     *
     * @param {string} payoutId - The payout ID
     * @param {string} recipientCode - Paystack transfer recipient code
     * @param {string} [reason="Consultant payout"] - Transfer reason
     * @returns {Promise<object>} The updated payout
     * @throws {ApiError} If payout not found, not PENDING, or transfer initiation fails
     */
    async initiatePayoutTransfer(payoutId, recipientCode, reason = "Consultant payout") {
        const payout = await Payout.findById(payoutId);

        if (!payout) {
            throw new ApiError(404, "Payout not found");
        }

        if (payout.status !== PAYOUT_STATUS.PENDING) {
            throw new ApiError(400, `Cannot initiate transfer for payout in ${payout.status} status`);
        }

        // Zero-net payout: recovery fully consumed the consultant's entitlement.
        // No Paystack transfer is needed. Complete the payout directly so that
        // included earnings transition to PAID via the existing completion path.
        if (payout.netAmount === 0) {
            return this.markPayoutAsCompleted(payoutId);
        }

        // Deterministic reference: stable across retries/restarts
        const transferReference = `TRF-${payout._id.toString()}`;

        let transferResult;
        try {
            transferResult = await initiateTransfer({
                amount: payout.netAmount,
                recipientCode,
                reference: transferReference,
                reason,
            });
        } catch (error) {
            // If Paystack explicitly rejects (client error), mark as failed
            if (error.message.includes("Paystack API error (4") && !error.message.includes("429")) {
                await this.markPayoutAsFailed(payoutId, `Paystack rejected transfer: ${error.message}`);
            }
            // For ambiguous errors (timeout, network, 429), re-throw without marking failed
            throw error;
        }

        // Persist transfer details and mark as PROCESSING
        const updatedPayout = await this.markPayoutAsProcessing(
            payoutId,
            transferResult.reference
        );

        // Persist Paystack transfer code if returned
        if (transferResult.transferCode) {
            updatedPayout.paystackTransferCode = transferResult.transferCode;
            await updatedPayout.save();
        }

        return updatedPayout;
    }

    /**
     * Mark a payout as completed (Paystack transfer successful).
     * Updates all included earnings to PAID status.
     * Runs in a MongoDB transaction so payout and earning states stay consistent.
     * @param {string} payoutId - The payout ID
     * @returns {Promise<object>} The updated payout
     * @throws {ApiError} If payout not found or not in PROCESSING status
     */
    async markPayoutAsCompleted(payoutId) {
        const mongoSession = await mongoose.startSession();

        try {
            return await mongoSession.withTransaction(async () => {
                const payout = await Payout.findById(payoutId).session(mongoSession);

                if (!payout) {
                    throw new ApiError(404, "Payout not found");
                }

                // Allow direct completion for zero-net payouts (recovery-settled, no transfer needed)
                const isZeroNetPayout = payout.status === PAYOUT_STATUS.PENDING && payout.netAmount === 0;
                if (payout.status !== PAYOUT_STATUS.PROCESSING && !isZeroNetPayout) {
                    throw new ApiError(400, `Cannot complete payout in ${payout.status} status`);
                }

                payout.status = PAYOUT_STATUS.COMPLETED;
                payout.completedAt = new Date();

                await payout.save({ session: mongoSession });

                // Update all included earnings to PAID
                await ConsultantEarning.updateMany(
                    { _id: { $in: payout.earningIds } },
                    {
                        $set: {
                            status: EARNING_STATUS.PAID,
                            paidAt: new Date(),
                        },
                        $push: {
                            statusHistory: {
                                from: EARNING_STATUS.IN_PAYOUT,
                                to: EARNING_STATUS.PAID,
                                changedAt: new Date(),
                                reason: `Payout ${payout._id} completed`,
                            },
                        },
                    },
                    { session: mongoSession }
                );

                return payout;
            });
        } finally {
            mongoSession.endSession();
        }
    }

    /**
     * Mark a payout as failed.
     * Runs in a MongoDB transaction so payout and earning states stay consistent.
     * @param {string} payoutId - The payout ID
     * @param {string} reason - The failure reason
     * @returns {Promise<object>} The updated payout
     * @throws {ApiError} If payout not found or not in PROCESSING status
     */
    async markPayoutAsFailed(payoutId, reason) {
        const mongoSession = await mongoose.startSession();

        try {
            return await mongoSession.withTransaction(async () => {
                const payout = await Payout.findById(payoutId).session(mongoSession);

                if (!payout) {
                    throw new ApiError(404, "Payout not found");
                }

                if (payout.status !== PAYOUT_STATUS.PROCESSING) {
                    throw new ApiError(400, `Cannot fail payout in ${payout.status} status`);
                }

                payout.status = PAYOUT_STATUS.FAILED;
                payout.failureReason = reason;

                await payout.save({ session: mongoSession });

                // Revert earnings back to ELIGIBLE for retry
                await ConsultantEarning.updateMany(
                    { _id: { $in: payout.earningIds } },
                    {
                        $set: {
                            status: EARNING_STATUS.ELIGIBLE,
                            payoutId: null,
                        },
                        $push: {
                            statusHistory: {
                                from: EARNING_STATUS.IN_PAYOUT,
                                to: EARNING_STATUS.ELIGIBLE,
                                changedAt: new Date(),
                                reason: `Payout ${payout._id} failed: ${reason}`,
                            },
                        },
                    },
                    { session: mongoSession }
                );

                return payout;
            });
        } finally {
            mongoSession.endSession();
        }
    }

    /**
     * Retry a failed payout.
     * Increments retry count and resets status to PENDING.
     * Prevents retry if maximum attempts (3) have been reached.
     * Runs in a MongoDB transaction so payout and earning states stay consistent.
     * @param {string} payoutId - The payout ID
     * @returns {Promise<object>} The updated payout
     * @throws {ApiError} If payout not found, not failed, or max retries reached
     */
    async retryPayout(payoutId) {
        const mongoSession = await mongoose.startSession();

        try {
            return await mongoSession.withTransaction(async () => {
                const payout = await Payout.findById(payoutId).session(mongoSession);

                if (!payout) {
                    throw new ApiError(404, "Payout not found");
                }

                if (payout.status !== PAYOUT_STATUS.FAILED) {
                    throw new ApiError(400, `Cannot retry payout in ${payout.status} status`);
                }

                if (!payout.canRetry) {
                    throw new ApiError(400, `Maximum retry attempts (${payout.retryCount}) reached for this payout`);
                }

                payout.retryCount += 1;
                payout.lastRetryAt = new Date();
                payout.status = PAYOUT_STATUS.PENDING;
                payout.failureReason = null;

                await payout.save({ session: mongoSession });

                // Re-mark earnings as IN_PAYOUT for this payout
                await ConsultantEarning.updateMany(
                    { _id: { $in: payout.earningIds } },
                    {
                        $set: {
                            status: EARNING_STATUS.IN_PAYOUT,
                            payoutId: payout._id,
                        },
                        $push: {
                            statusHistory: {
                                from: EARNING_STATUS.ELIGIBLE,
                                to: EARNING_STATUS.IN_PAYOUT,
                                changedAt: new Date(),
                                reason: `Payout ${payout._id} retry attempt ${payout.retryCount}`,
                            },
                        },
                    },
                    { session: mongoSession }
                );

                return payout;
            });
        } finally {
            mongoSession.endSession();
        }
    }
}

// ---------------------------------------------------------------------------
// Export Singleton
// ---------------------------------------------------------------------------

export default new PayoutService();
