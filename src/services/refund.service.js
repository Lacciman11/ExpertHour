import mongoose from "mongoose";

import Payment from "../models/Payment.js";
import Booking from "../models/Booking.js";
import ConsultantEarning from "../models/ConsultantEarning.js";
import ApiError from "../utils/ApiError.js";
import {
    EARNING_STATUS,
    ADJUSTMENT_REASON,
} from "../utils/constants.js";
import { paystackClient } from "./payment.service.js";

// ---------------------------------------------------------------------------
// Refund Processing State
// ---------------------------------------------------------------------------

const REFUND_PROCESSING_STATE = Object.freeze({
    REFUND_REQUESTED: "REFUND_REQUESTED",
    REFUND_CONFIRMED: "REFUND_CONFIRMED",
    REFUND_FAILED: "REFUND_FAILED",
});

// ---------------------------------------------------------------------------
// Refund Eligibility Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that the payment exists.
 * @param {object} payment - The Payment document
 * @throws {ApiError} If payment not found
 */
function validatePaymentExists(payment) {
    if (!payment) {
        throw new ApiError(404, "Payment not found");
    }
}

/**
 * Validate that the booking exists.
 * @param {object} booking - The Booking document
 * @throws {ApiError} If booking not found
 */
function validateBookingExists(booking) {
    if (!booking) {
        throw new ApiError(404, "Booking not found");
    }
}

/**
 * Validate that the payment belongs to the booking.
 * @param {object} payment - The Payment document
 * @param {object} booking - The Booking document
 * @throws {ApiError} If payment does not belong to booking
 */
function validatePaymentBelongsToBooking(payment, booking) {
    if (payment.bookingId.toString() !== booking._id.toString()) {
        throw new ApiError(400, "Payment does not belong to the specified booking");
    }
}

/**
 * Validate that the payment is eligible for refund.
 * @param {object} payment - The Payment document
 * @throws {ApiError} If payment is not eligible for refund
 */
function validatePaymentEligibleForRefund(payment) {
    if (payment.status !== "success") {
        throw new ApiError(400, "Cannot refund a payment that is not successful");
    }
}

/**
 * Validate that the refund amount is positive.
 * @param {number} refundAmount - The refund amount in kobo
 * @throws {ApiError} If refund amount is not positive
 */
function validateRefundAmountPositive(refundAmount) {
    if (refundAmount <= 0) {
        throw new ApiError(400, "Refund amount must be positive");
    }
}

/**
 * Validate that the refund does not exceed the remaining refundable amount.
 * @param {number} refundAmount - The refund amount in kobo
 * @param {number} remainingRefundableAmount - The remaining refundable amount in kobo
 * @throws {ApiError} If refund exceeds remaining refundable amount
 */
function validateRefundDoesNotExceedRemaining(refundAmount, remainingRefundableAmount) {
    if (refundAmount > remainingRefundableAmount) {
        throw new ApiError(
            400,
            `Refund amount ${refundAmount} exceeds remaining refundable amount ${remainingRefundableAmount}`
        );
    }
}

/**
 * Validate that the refund reference is provided.
 * @param {string} refundReference - The refund reference
 * @throws {ApiError} If refund reference is missing
 */
function validateRefundReference(refundReference) {
    if (!refundReference || refundReference.trim() === "") {
        throw new ApiError(400, "Refund reference is required");
    }
}

/**
 * Validate that the refund reason is valid.
 * @param {string} reason - The refund reason
 * @throws {ApiError} If refund reason is invalid
 */
function validateRefundReason(reason) {
    const validReasons = Object.values(ADJUSTMENT_REASON);
    if (!validReasons.includes(reason)) {
        throw new ApiError(400, `Invalid refund reason. Must be one of: ${validReasons.join(", ")}`);
    }
}

// ---------------------------------------------------------------------------
// Refund Calculation Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate remaining refundable amount for an earning.
 * @param {object} earning - The ConsultantEarning document
 * @returns {number} Remaining refundable amount in kobo
 */
function calculateRemainingRefundableAmount(earning) {
    return earning.grossAmount - earning.adjustmentAmount;
}

/**
 * Calculate adjusted values from original snapshot.
 * @param {object} earning - The ConsultantEarning document
 * @param {number} newAdjustmentAmount - The new cumulative adjustment amount
 * @returns {object} Adjusted values
 */
function calculateAdjustedValues(earning, newAdjustmentAmount) {
    const isFullRefund = newAdjustmentAmount >= earning.grossAmount;

    if (isFullRefund) {
        return {
            adjustedGrossAmount: 0,
            adjustedPlatformCommission: 0,
            adjustedConsultantEntitlement: 0,
            isFullRefund: true,
        };
    }

    const adjustedGrossAmount = earning.grossAmount - newAdjustmentAmount;
    const adjustedPlatformCommission = Math.round(adjustedGrossAmount * earning.platformCommissionRate);
    const adjustedConsultantEntitlement = adjustedGrossAmount - adjustedPlatformCommission;

    return {
        adjustedGrossAmount,
        adjustedPlatformCommission,
        adjustedConsultantEntitlement,
        isFullRefund: false,
    };
}

// ---------------------------------------------------------------------------
// Post-Payout Protection
// ---------------------------------------------------------------------------

/**
 * Check if a refund can be processed based on earning status.
 * @param {object} earning - The ConsultantEarning document
 * @returns {object} Result with allowed flag, optional recovery flag, and
 *   optional warning/reason
 */
function canProcessRefund(earning) {
    if (earning.status === EARNING_STATUS.PAID) {
        // Post-payout refund: allowed, but it creates a recovery obligation
        // against the consultant instead of adjusting the (already paid) earning.
        return {
            allowed: true,
            recovery: true,
            warning: "Earning already paid. Creating post-payout recovery obligation.",
        };
    }

    if (earning.status === EARNING_STATUS.IN_PAYOUT) {
        return {
            allowed: true,
            warning: "Earning is in payout. Consider canceling payout first.",
        };
    }

    return { allowed: true };
}

// ---------------------------------------------------------------------------
// Idempotency Check
// ---------------------------------------------------------------------------

/**
 * Check if a refund with the given reference already exists.
 * @param {object} earning - The ConsultantEarning document
 * @param {string} refundReference - The refund reference
 * @returns {object|null} Existing refund event or null
 */
function findExistingRefund(earning, refundReference) {
    return earning.refundHistory.find(
        (event) => event.refundReference === refundReference
    ) || null;
}

/**
 * Check if a post-payout recovery with the given reference already exists.
 * @param {object} earning - The ConsultantEarning document
 * @param {string} refundReference - The refund reference
 * @returns {object|null} Existing recovery event or null
 */
function findExistingRecovery(earning, refundReference) {
    if (!earning.recoveryHistory || earning.recoveryHistory.length === 0) {
        return null;
    }
    return earning.recoveryHistory.find(
        (event) => event.refundReference === refundReference
    ) || null;
}

// ---------------------------------------------------------------------------
// Post-Payout Recovery Processing
// ---------------------------------------------------------------------------

/**
 * Calculate the recovery amount for a post-payout refund.
 *
 * The consultant already received their payout, so the refund cannot reduce the
 * earning's adjustment accounting (which is bounded by grossAmount). Instead we
 * create a recovery obligation capped at the consultant's immutable entitlement
 * (a consultant can never owe more than they were originally entitled to).
 *
 * @param {object} earning - The ConsultantEarning document
 * @param {number} refundAmount - Requested refund amount in kobo
 * @returns {number} Recovery amount in kobo
 */
function calculateRecoveryAmount(earning, refundAmount) {
    const entitlement = earning.consultantEntitlement;
    const alreadyRecovered = earning.recoveryAmount || 0;
    const remainingEntitlement = entitlement - alreadyRecovered;

    // Recovery is capped at the consultant's remaining entitlement.
    return Math.max(0, Math.min(refundAmount, remainingEntitlement));
}

/**
 * Process a post-payout refund by creating a recovery obligation against the
 * consultant. The payment is still refunded to the client and the booking/payment
 * records are updated, but the earning's immutable snapshot and adjustment
 * accounting are left untouched — the debt is tracked via recoveryAmount and
 * recoveryHistory instead.
 *
 * Must be called inside a MongoDB transaction.
 *
 * @param {object} params - Recovery parameters
 * @param {object} params.earning - The ConsultantEarning document (in-tx)
 * @param {object} params.payment - The Payment document (in-tx)
 * @param {object} params.booking - The Booking document (in-tx)
 * @param {string} params.refundReference - Unique refund reference
 * @param {number} params.refundAmount - Refund amount in kobo
 * @param {string} params.reason - Refund reason
 * @param {string} params.adminId - Admin user ID
 * @param {object} params.mongoSession - The Mongoose session
 * @returns {object} Recovery result
 */
async function processRecovery({
    earning,
    payment,
    booking,
    refundReference,
    refundAmount,
    reason,
    adminId,
    mongoSession,
}) {
    // Idempotency: a recovery with the same reference must not be duplicated.
    const existingRecovery = findExistingRecovery(earning, refundReference);
    if (existingRecovery) {
        return {
            success: true,
            idempotent: true,
            recovery: existingRecovery,
            earning,
            payment,
            booking,
        };
    }

    const recoveryAmount = calculateRecoveryAmount(earning, refundAmount);

    // 1. Update payment refund fields (the client is still refunded).
    const previousPaymentRefundAmount = payment.refundAmount || 0;
    payment.refundAmount = previousPaymentRefundAmount + refundAmount;

    const isFullRefund = payment.refundAmount >= payment.amount;
    payment.refundStatus = isFullRefund ? "completed" : "pending";
    payment.refundReference = refundReference;
    if (isFullRefund) {
        payment.refundedAt = new Date();
    }
    await payment.save({ session: mongoSession });

    // 2. Update booking refund status.
    booking.refundStatus = isFullRefund ? "completed" : "pending";
    if (isFullRefund) {
        booking.refundedAt = new Date();
        booking.paymentStatus = "refunded";
    }
    await booking.save({ session: mongoSession });

    // 3. Record the recovery obligation against the consultant.
    // The earning stays PAID — we never modify the immutable snapshot or the
    // adjustment accounting for a post-payout refund.
    earning.recoveryAmount = (earning.recoveryAmount || 0) + recoveryAmount;
    earning.recoveryHistory.push({
        refundReference,
        recoveryAmount,
        reason,
        processedAt: new Date(),
        processedBy: adminId,
    });
    await earning.save({ session: mongoSession });

    return {
        success: true,
        idempotent: false,
        recovery: earning.recoveryHistory[earning.recoveryHistory.length - 1],
        recoveryAmount,
        earning,
        payment,
        booking,
        warning: "Earning already paid. Created post-payout recovery obligation.",
    };
}

// ---------------------------------------------------------------------------
// Refund Service Class
// ---------------------------------------------------------------------------

class RefundService {

    /**
     * Process a refund for a payment.
     *
     * @param {object} params - Refund parameters
     * @param {string} params.paymentId - The payment ID
     * @param {string} params.bookingId - The booking ID
     * @param {string} params.refundReference - Unique refund reference for idempotency
     * @param {number} params.refundAmount - Refund amount in kobo
     * @param {string} params.reason - Refund reason (ADJUSTMENT_REASON enum value)
     * @param {string} params.adminId - Admin user ID processing the refund
     * @param {string} [params.notes] - Optional notes
     * @returns {Promise<object>} Refund result
     * @throws {ApiError} If validation fails or processing error occurs
     */
    async processRefund({
        paymentId,
        bookingId,
        refundReference,
        refundAmount,
        reason,
        adminId,
        notes = null,
    }) {
        // Validate inputs
        validateRefundReference(refundReference);
        validateRefundAmountPositive(refundAmount);
        validateRefundReason(reason);

        // Validate ObjectIds
        if (!mongoose.Types.ObjectId.isValid(paymentId)) {
            throw new ApiError(400, "Invalid payment ID");
        }
        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            throw new ApiError(400, "Invalid booking ID");
        }

        // Start a session for transaction support
        const mongoSession = await mongoose.startSession();

        try {
            const result = await mongoSession.withTransaction(async () => {
                // 1. Fetch payment, booking, and earning
                const payment = await Payment.findById(paymentId).session(mongoSession);
                const booking = await Booking.findById(bookingId).session(mongoSession);
                const earning = await ConsultantEarning.findOne({ paymentId }).session(mongoSession);

                // 2. Validate existence
                validatePaymentExists(payment);
                validateBookingExists(booking);

                // 3. Validate payment belongs to booking
                validatePaymentBelongsToBooking(payment, booking);

                // 4. Validate payment is eligible for refund
                validatePaymentEligibleForRefund(payment);

                // 5. Check for existing earning (may not exist for some payments)
                if (!earning) {
                    throw new ApiError(404, "Consultant earning not found for this payment");
                }

                // 6. Check post-payout protection (determines refund vs recovery path)
                const refundCheck = canProcessRefund(earning);
                if (!refundCheck.allowed) {
                    throw new ApiError(400, refundCheck.reason);
                }

                // 7. Post-payout recovery path: earning is already PAID.
                if (refundCheck.recovery) {
                    return processRecovery({
                        earning,
                        payment,
                        booking,
                        refundReference,
                        refundAmount,
                        reason,
                        adminId,
                        mongoSession,
                    });
                }

                // 8. Check idempotency - existing refund with same reference
                const existingRefund = findExistingRefund(earning, refundReference);
                if (existingRefund) {
                    return {
                        success: true,
                        idempotent: true,
                        refund: existingRefund,
                        earning,
                        payment,
                        booking,
                    };
                }

                // 9. Calculate remaining refundable amount
                const remainingRefundableAmount = calculateRemainingRefundableAmount(earning);

                // 9. Validate refund amount does not exceed remaining
                validateRefundDoesNotExceedRemaining(refundAmount, remainingRefundableAmount);

                // 10. Calculate new cumulative adjustment
                const newAdjustmentAmount = earning.adjustmentAmount + refundAmount;

                // 11. Calculate adjusted values from original snapshot
                const adjustedValues = calculateAdjustedValues(earning, newAdjustmentAmount);

                // 12. Store previous adjusted values for history (use 0 if null)
                const previousAdjustedGrossAmount = earning.adjustedGrossAmount || 0;
                const previousAdjustedPlatformCommission = earning.adjustedPlatformCommission || 0;
                const previousAdjustedConsultantEntitlement = earning.adjustedConsultantEntitlement || 0;

                // 13. Update earning adjustment fields
                earning.adjustmentAmount = newAdjustmentAmount;
                earning.adjustedGrossAmount = adjustedValues.adjustedGrossAmount;
                earning.adjustedPlatformCommission = adjustedValues.adjustedPlatformCommission;
                earning.adjustedConsultantEntitlement = adjustedValues.adjustedConsultantEntitlement;
                earning.adjustmentReason = adjustedValues.isFullRefund ? ADJUSTMENT_REASON.FULL_REFUND : reason;
                earning.adjustedAt = new Date();
                earning.adjustedBy = adminId;

                // 14. Update earning status
                const oldStatus = earning.status;
                if (adjustedValues.isFullRefund) {
                    earning.status = EARNING_STATUS.CANCELLED;
                } else if (earning.status !== EARNING_STATUS.PAID && earning.status !== EARNING_STATUS.IN_PAYOUT) {
                    earning.status = EARNING_STATUS.ADJUSTED;
                }

                // 15. Add to status history
                earning.statusHistory.push({
                    from: oldStatus,
                    to: earning.status,
                    changedAt: new Date(),
                    changedBy: adminId,
                    reason: `Refund ${refundReference}: ${refundAmount}. Cumulative: ${newAdjustmentAmount}`,
                });

                // 16. Append refund event to history
                earning.refundHistory.push({
                    refundReference,
                    refundAmount,
                    cumulativeRefundAmount: newAdjustmentAmount,
                    previousAdjustedGrossAmount,
                    newAdjustedGrossAmount: adjustedValues.adjustedGrossAmount,
                    previousAdjustedPlatformCommission,
                    newAdjustedPlatformCommission: adjustedValues.adjustedPlatformCommission,
                    previousAdjustedConsultantEntitlement,
                    newAdjustedConsultantEntitlement: adjustedValues.adjustedConsultantEntitlement,
                    reason: adjustedValues.isFullRefund ? ADJUSTMENT_REASON.FULL_REFUND : reason,
                    processedAt: new Date(),
                    processedBy: adminId,
                });

                // 17. Save earning
                await earning.save({ session: mongoSession });

                // 18. Update payment refund fields
                const previousPaymentRefundAmount = payment.refundAmount || 0;
                payment.refundAmount = previousPaymentRefundAmount + refundAmount;

                // Determine if this is a full or partial refund
                const isFullRefund = payment.refundAmount >= payment.amount;
                payment.refundStatus = isFullRefund ? "completed" : "pending";
                payment.refundReference = refundReference;
                if (isFullRefund) {
                    payment.refundedAt = new Date();
                }
                await payment.save({ session: mongoSession });

                // 19. Update booking refund status
                booking.refundStatus = isFullRefund ? "completed" : "pending";
                if (isFullRefund) {
                    booking.refundedAt = new Date();
                    booking.paymentStatus = "refunded";
                }
                await booking.save({ session: mongoSession });

                return {
                    success: true,
                    idempotent: false,
                    refund: earning.refundHistory[earning.refundHistory.length - 1],
                    earning,
                    payment,
                    booking,
                    warning: refundCheck.warning || null,
                };
            });

            return result;
        } catch (error) {
            // Re-throw ApiError instances
            if (error instanceof ApiError) {
                throw error;
            }

            // Wrap other errors
            throw new ApiError(500, `Failed to process refund: ${error.message}`);
        } finally {
            mongoSession.endSession();
        }
    }

    /**
     * Process a refund through Paystack and update local state.
     *
     * This method initiates the refund with Paystack first, then updates
     * the local database state. The Paystack API call occurs OUTSIDE the
     * MongoDB transaction to avoid holding the transaction open during
     * external API calls.
     *
     * @param {object} params - Refund parameters
     * @param {string} params.paymentId - The payment ID
     * @param {string} params.bookingId - The booking ID
     * @param {string} params.refundReference - Unique refund reference for idempotency
     * @param {number} params.refundAmount - Refund amount in kobo
     * @param {string} params.reason - Refund reason
     * @param {string} params.adminId - Admin user ID
     * @param {string} [params.notes] - Optional notes
     * @returns {Promise<object>} Refund result with Paystack response
     * @throws {ApiError} If validation fails or processing error occurs
     */
    async processRefundWithPaystack({
        paymentId,
        bookingId,
        refundReference,
        refundAmount,
        reason,
        adminId,
        notes = null,
    }) {
        // Validate inputs
        validateRefundReference(refundReference);
        validateRefundAmountPositive(refundAmount);
        validateRefundReason(reason);

        // Validate ObjectIds
        if (!mongoose.Types.ObjectId.isValid(paymentId)) {
            throw new ApiError(400, "Invalid payment ID");
        }
        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            throw new ApiError(400, "Invalid booking ID");
        }

        // 1. Fetch payment, booking, and earning for validation
        const payment = await Payment.findById(paymentId);
        const booking = await Booking.findById(bookingId);
        const earning = await ConsultantEarning.findOne({ paymentId });

        // 2. Validate existence
        validatePaymentExists(payment);
        validateBookingExists(booking);

        // 3. Validate payment belongs to booking
        validatePaymentBelongsToBooking(payment, booking);

        // 4. Validate payment is eligible for refund
        validatePaymentEligibleForRefund(payment);

        // 5. Check for existing earning
        if (!earning) {
            throw new ApiError(404, "Consultant earning not found for this payment");
        }

        // 6. Check post-payout protection (determines refund vs recovery path)
        const refundCheck = canProcessRefund(earning);
        if (!refundCheck.allowed) {
            throw new ApiError(400, refundCheck.reason);
        }

        // 7. Idempotency check (path-aware)
        if (refundCheck.recovery) {
            const existingRecovery = findExistingRecovery(earning, refundReference);
            if (existingRecovery) {
                return {
                    success: true,
                    idempotent: true,
                    recovery: existingRecovery,
                    earning,
                    payment,
                    booking,
                };
            }
        } else {
            const existingRefund = findExistingRefund(earning, refundReference);
            if (existingRefund) {
                return {
                    success: true,
                    idempotent: true,
                    refund: existingRefund,
                    earning,
                    payment,
                    booking,
                };
            }
        }

        // 8. For non-PAID earnings, validate refund against remaining refundable amount.
        //    (Recovery amounts are capped by consultantEntitlement instead.)
        if (!refundCheck.recovery) {
            const remainingRefundableAmount = calculateRemainingRefundableAmount(earning);

            // 9. Validate refund amount does not exceed remaining
            validateRefundDoesNotExceedRemaining(refundAmount, remainingRefundableAmount);
        }

        // 10. Initiate refund with Paystack (OUTSIDE transaction)
        let paystackResponse;
        try {
            const response = await paystackClient.request("POST", "/refund", {
                transaction: payment.reference,
                amount: refundAmount,
            });
            paystackResponse = response.data;
        } catch (error) {
            throw new ApiError(500, `Failed to initiate refund with Paystack: ${error.message}`);
        }

        // 10b. Preserve the Paystack refund reference on the Payment BEFORE the
        //      MongoDB transaction. If the local transaction fails after this
        //      point, the reference is retained so the successful external
        //      refund can be reconciled later (see reconcileRefundWithPaystack).
        //      Status "pending" here means: Paystack refund initiated, local
        //      update not yet confirmed.
        payment.refundReference = refundReference;
        payment.refundStatus = "pending";
        await payment.save();

        // 11. Update local state in transaction
        const mongoSession = await mongoose.startSession();

        try {
            const result = await mongoSession.withTransaction(async () => {
                // Re-fetch documents within transaction
                const paymentInTx = await Payment.findById(paymentId).session(mongoSession);
                const bookingInTx = await Booking.findById(bookingId).session(mongoSession);
                const earningInTx = await ConsultantEarning.findOne({ paymentId }).session(mongoSession);

                // Post-payout recovery path: earning is already PAID.
                if (refundCheck.recovery) {
                    const recoveryResult = await processRecovery({
                        earning: earningInTx,
                        payment: paymentInTx,
                        booking: bookingInTx,
                        refundReference,
                        refundAmount,
                        reason,
                        adminId,
                        mongoSession,
                    });

                    // Attach the Paystack response for callers that need it.
                    if (recoveryResult.success) {
                        recoveryResult.paystackResponse = paystackResponse;
                    }
                    return recoveryResult;
                }

                // Double-check idempotency within transaction
                const existingRefundInTx = findExistingRefund(earningInTx, refundReference);
                if (existingRefundInTx) {
                    return {
                        success: true,
                        idempotent: true,
                        refund: existingRefundInTx,
                        earning: earningInTx,
                        payment: paymentInTx,
                        booking: bookingInTx,
                    };
                }

                // Calculate new cumulative adjustment
                const newAdjustmentAmount = earningInTx.adjustmentAmount + refundAmount;

                // Calculate adjusted values from original snapshot
                const adjustedValues = calculateAdjustedValues(earningInTx, newAdjustmentAmount);

                // Store previous adjusted values for history (use 0 if null)
                const previousAdjustedGrossAmount = earningInTx.adjustedGrossAmount || 0;
                const previousAdjustedPlatformCommission = earningInTx.adjustedPlatformCommission || 0;
                const previousAdjustedConsultantEntitlement = earningInTx.adjustedConsultantEntitlement || 0;

                // Update earning adjustment fields
                earningInTx.adjustmentAmount = newAdjustmentAmount;
                earningInTx.adjustedGrossAmount = adjustedValues.adjustedGrossAmount;
                earningInTx.adjustedPlatformCommission = adjustedValues.adjustedPlatformCommission;
                earningInTx.adjustedConsultantEntitlement = adjustedValues.adjustedConsultantEntitlement;
                earningInTx.adjustmentReason = adjustedValues.isFullRefund ? ADJUSTMENT_REASON.FULL_REFUND : reason;
                earningInTx.adjustedAt = new Date();
                earningInTx.adjustedBy = adminId;

                // Update earning status
                const oldStatus = earningInTx.status;
                if (adjustedValues.isFullRefund) {
                    earningInTx.status = EARNING_STATUS.CANCELLED;
                } else if (earningInTx.status !== EARNING_STATUS.PAID && earningInTx.status !== EARNING_STATUS.IN_PAYOUT) {
                    earningInTx.status = EARNING_STATUS.ADJUSTED;
                }

                // Add to status history
                earningInTx.statusHistory.push({
                    from: oldStatus,
                    to: earningInTx.status,
                    changedAt: new Date(),
                    changedBy: adminId,
                    reason: `Refund ${refundReference}: ${refundAmount}. Cumulative: ${newAdjustmentAmount}`,
                });

                // Append refund event to history
                earningInTx.refundHistory.push({
                    refundReference,
                    refundAmount,
                    cumulativeRefundAmount: newAdjustmentAmount,
                    previousAdjustedGrossAmount,
                    newAdjustedGrossAmount: adjustedValues.adjustedGrossAmount,
                    previousAdjustedPlatformCommission,
                    newAdjustedPlatformCommission: adjustedValues.adjustedPlatformCommission,
                    previousAdjustedConsultantEntitlement,
                    newAdjustedConsultantEntitlement: adjustedValues.adjustedConsultantEntitlement,
                    reason: adjustedValues.isFullRefund ? ADJUSTMENT_REASON.FULL_REFUND : reason,
                    processedAt: new Date(),
                    processedBy: adminId,
                });

                // Save earning
                await earningInTx.save({ session: mongoSession });

                // Update payment refund fields
                const previousPaymentRefundAmount = paymentInTx.refundAmount || 0;
                paymentInTx.refundAmount = previousPaymentRefundAmount + refundAmount;

                // Determine if this is a full or partial refund
                const isFullRefund = paymentInTx.refundAmount >= paymentInTx.amount;
                paymentInTx.refundStatus = isFullRefund ? "completed" : "pending";
                paymentInTx.refundReference = refundReference;
                if (isFullRefund) {
                    paymentInTx.refundedAt = new Date();
                }
                await paymentInTx.save({ session: mongoSession });

                // Update booking refund status
                bookingInTx.refundStatus = isFullRefund ? "completed" : "pending";
                if (isFullRefund) {
                    bookingInTx.refundedAt = new Date();
                    bookingInTx.paymentStatus = "refunded";
                }
                await bookingInTx.save({ session: mongoSession });

                return {
                    success: true,
                    idempotent: false,
                    refund: earningInTx.refundHistory[earningInTx.refundHistory.length - 1],
                    earning: earningInTx,
                    payment: paymentInTx,
                    booking: bookingInTx,
                    paystackResponse,
                    warning: refundCheck.warning || null,
                };
            });

            return result;
        } catch (error) {
            // Re-throw ApiError instances
            if (error instanceof ApiError) {
                throw error;
            }

            // Wrap other errors
            throw new ApiError(500, `Failed to update local state after Paystack refund: ${error.message}`);
        } finally {
            mongoSession.endSession();
        }
    }

    /**
     * Reconcile a Paystack refund when the external refund succeeded but the
     * local MongoDB transaction failed to commit.
     *
     * Scenario: processRefundWithPaystack() calls Paystack (which succeeds),
     * then attempts a local DB transaction. If that transaction fails, the
     * Payment row still has refundStatus="pending" and refundReference set
     * (saved before the transaction), but the ConsultantEarning/Booking state
     * was never updated.
     *
     * This method:
     * 1. Reads the stored refundReference from the Payment.
     * 2. Queries Paystack to confirm the refund status (read-only, no new refund).
     * 3. If Paystack confirms success, applies the local state changes in a
     *    fresh transaction (idempotent — uses refundReference for dedup).
     *
     * This method NEVER initiates a new Paystack refund. It only reconciles
     * local state with an already-successful external refund.
     *
     * @param {string} paymentId - The payment ID to reconcile
     * @returns {Promise<object>} Reconciliation result
     * @throws {ApiError} If payment not found or reconciliation fails
     */
    async reconcileRefundWithPaystack(paymentId) {
        if (!mongoose.Types.ObjectId.isValid(paymentId)) {
            throw new ApiError(400, "Invalid payment ID");
        }

        // 1. Fetch the payment and verify it has a pending refund reference.
        const payment = await Payment.findById(paymentId);

        if (!payment) {
            throw new ApiError(404, "Payment not found");
        }

        if (!payment.refundReference || payment.refundStatus !== "pending") {
            return {
                success: true,
                reconciled: false,
                reason: "No pending refund to reconcile",
            };
        }

        const refundReference = payment.refundReference;

        // 2. Query Paystack for the refund status (read-only).
        let paystackRefundStatus;
        try {
            const response = await paystackClient.request(
                "GET",
                `/refund/${refundReference}`
            );
            paystackRefundStatus = response.data?.data?.status || "unknown";
        } catch (error) {
            throw new ApiError(500, `Failed to query Paystack refund status: ${error.message}`);
        }

        // If Paystack says the refund failed, mark it failed locally and return.
        if (paystackRefundStatus === "failed") {
            payment.refundStatus = "failed";
            await payment.save();
            return {
                success: true,
                reconciled: false,
                reason: "Paystack refund failed",
                paystackStatus: paystackRefundStatus,
            };
        }

        // If Paystack still says pending, nothing to reconcile yet.
        if (paystackRefundStatus !== "success") {
            return {
                success: true,
                reconciled: false,
                reason: `Paystack refund status is ${paystackRefundStatus}`,
                paystackStatus: paystackRefundStatus,
            };
        }

        // 3. Paystack confirms success — apply local state in a fresh transaction.
        //    This is idempotent: if the original transaction actually committed
        //    (e.g., the error was in the post-transaction response handling), the
        //    idempotency check inside the transaction will short-circuit.
        const booking = await Booking.findById(payment.bookingId);
        if (!booking) {
            throw new ApiError(404, "Booking not found for this payment");
        }

        const earning = await ConsultantEarning.findOne({ paymentId });
        if (!earning) {
            throw new ApiError(404, "Consultant earning not found for this payment");
        }

        const mongoSession = await mongoose.startSession();

        try {
            const result = await mongoSession.withTransaction(async () => {
                const paymentInTx = await Payment.findById(paymentId).session(mongoSession);
                const bookingInTx = await Booking.findById(booking._id).session(mongoSession);
                const earningInTx = await ConsultantEarning.findOne({ paymentId }).session(mongoSession);

                // Idempotency: if the refund was already recorded, short-circuit.
                const existingRefund = findExistingRefund(earningInTx, refundReference);
                if (existingRefund) {
                    return {
                        success: true,
                        idempotent: true,
                        refund: existingRefund,
                    };
                }

                // Determine the refund amount from the payment record.
                // The refundAmount was stored on the payment before the original
                // transaction failed, or we fall back to the full payment amount.
                const refundAmount = paymentInTx.refundAmount || paymentInTx.amount;

                // Post-payout recovery path: earning is already PAID.
                const refundCheck = canProcessRefund(earningInTx);
                if (refundCheck.recovery) {
                    const recoveryResult = await processRecovery({
                        earning: earningInTx,
                        payment: paymentInTx,
                        booking: bookingInTx,
                        refundReference,
                        refundAmount,
                        reason: earningInTx.adjustmentReason || ADJUSTMENT_REASON.FULL_REFUND,
                        adminId: null, // Reconciliation is automatic, no admin
                        mongoSession,
                    });
                    return recoveryResult;
                }

                // Standard refund path: apply adjustment accounting.
                const newAdjustmentAmount = earningInTx.adjustmentAmount + refundAmount;
                const adjustedValues = calculateAdjustedValues(earningInTx, newAdjustmentAmount);

                const previousAdjustedGrossAmount = earningInTx.adjustedGrossAmount || 0;
                const previousAdjustedPlatformCommission = earningInTx.adjustedPlatformCommission || 0;
                const previousAdjustedConsultantEntitlement = earningInTx.adjustedConsultantEntitlement || 0;

                earningInTx.adjustmentAmount = newAdjustmentAmount;
                earningInTx.adjustedGrossAmount = adjustedValues.adjustedGrossAmount;
                earningInTx.adjustedPlatformCommission = adjustedValues.adjustedPlatformCommission;
                earningInTx.adjustedConsultantEntitlement = adjustedValues.adjustedConsultantEntitlement;
                earningInTx.adjustmentReason = adjustedValues.isFullRefund ? ADJUSTMENT_REASON.FULL_REFUND : ADJUSTMENT_REASON.PARTIAL_REFUND;
                earningInTx.adjustedAt = new Date();

                const oldStatus = earningInTx.status;
                if (adjustedValues.isFullRefund) {
                    earningInTx.status = EARNING_STATUS.CANCELLED;
                } else if (earningInTx.status !== EARNING_STATUS.PAID && earningInTx.status !== EARNING_STATUS.IN_PAYOUT) {
                    earningInTx.status = EARNING_STATUS.ADJUSTED;
                }

                earningInTx.statusHistory.push({
                    from: oldStatus,
                    to: earningInTx.status,
                    changedAt: new Date(),
                    reason: `Refund ${refundReference}: ${refundAmount}. Cumulative: ${newAdjustmentAmount}`,
                });

                earningInTx.refundHistory.push({
                    refundReference,
                    refundAmount,
                    cumulativeRefundAmount: newAdjustmentAmount,
                    previousAdjustedGrossAmount,
                    newAdjustedGrossAmount: adjustedValues.adjustedGrossAmount,
                    previousAdjustedPlatformCommission,
                    newAdjustedPlatformCommission: adjustedValues.adjustedPlatformCommission,
                    previousAdjustedConsultantEntitlement,
                    newAdjustedConsultantEntitlement: adjustedValues.adjustedConsultantEntitlement,
                    reason: adjustedValues.isFullRefund ? ADJUSTMENT_REASON.FULL_REFUND : ADJUSTMENT_REASON.PARTIAL_REFUND,
                    processedAt: new Date(),
                });

                await earningInTx.save({ session: mongoSession });

                const isFullRefund = paymentInTx.refundAmount >= paymentInTx.amount;
                paymentInTx.refundStatus = isFullRefund ? "completed" : "pending";
                if (isFullRefund) {
                    paymentInTx.refundedAt = new Date();
                }
                await paymentInTx.save({ session: mongoSession });

                bookingInTx.refundStatus = isFullRefund ? "completed" : "pending";
                if (isFullRefund) {
                    bookingInTx.refundedAt = new Date();
                    bookingInTx.paymentStatus = "refunded";
                }
                await bookingInTx.save({ session: mongoSession });

                return {
                    success: true,
                    idempotent: false,
                    refund: earningInTx.refundHistory[earningInTx.refundHistory.length - 1],
                    earning: earningInTx,
                    payment: paymentInTx,
                    booking: bookingInTx,
                };
            });

            return {
                success: true,
                reconciled: true,
                paystackStatus: paystackRefundStatus,
                ...result,
            };
        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            }
            throw new ApiError(500, `Failed to reconcile refund: ${error.message}`);
        } finally {
            mongoSession.endSession();
        }
    }

    /**
     * Get refund history for an earning.
     * @param {string} paymentId - The payment ID
     * @returns {Promise<Array>} Array of refund events
     * @throws {ApiError} If earning not found
     */
    async getRefundHistory(paymentId) {
        const earning = await ConsultantEarning.findOne({ paymentId });

        if (!earning) {
            throw new ApiError(404, "Consultant earning not found for this payment");
        }

        return earning.refundHistory;
    }

    /**
     * Get refund details by reference.
     * @param {string} paymentId - The payment ID
     * @param {string} refundReference - The refund reference
     * @returns {Promise<object>} Refund event details
     * @throws {ApiError} If refund not found
     */
    async getRefundByReference(paymentId, refundReference) {
        const earning = await ConsultantEarning.findOne({ paymentId });

        if (!earning) {
            throw new ApiError(404, "Consultant earning not found for this payment");
        }

        const refund = findExistingRefund(earning, refundReference);

        if (!refund) {
            throw new ApiError(404, "Refund not found");
        }

        return refund;
    }

    /**
     * Check if a refund reference has already been processed.
     * @param {string} paymentId - The payment ID
     * @param {string} refundReference - The refund reference
     * @returns {Promise<boolean>} True if refund exists
     */
    async refundExists(paymentId, refundReference) {
        const earning = await ConsultantEarning.findOne({ paymentId });

        if (!earning) {
            return false;
        }

        return findExistingRefund(earning, refundReference) !== null;
    }
}

// ---------------------------------------------------------------------------
// Export Singleton
// ---------------------------------------------------------------------------

export default new RefundService();
