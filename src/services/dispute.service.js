import mongoose from "mongoose";

import Dispute from "../models/Dispute.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import ConsultantEarning from "../models/ConsultantEarning.js";
import ApiError from "../utils/ApiError.js";
import env from "../config/env.js";
import { DISPUTE_RESOLUTION, USER_ROLES, EARNING_STATUS, HOLD_REASON } from "../utils/constants.js";

class DisputeService {
    async openDispute(bookingId, reason, actor) {
        if (!mongoose.Types.ObjectId.isValid(bookingId)) {
            throw new ApiError(400, "Invalid booking ID");
        }
        const validReasons = ["service_not_rendered", "quality_issue", "no_show", "billing_error", "other"];
        if (!validReasons.includes(reason)) {
            throw new ApiError(400, "Invalid dispute reason");
        }
        if (!actor || !actor._id) {
            throw new ApiError(401, "Authentication required");
        }

        // Look up the booking first to enforce authorization before idempotency.
        const booking = await Booking.findById(bookingId);
        if (!booking) throw new ApiError(404, "Booking not found");

        // Restrictive: only the booking's client may open a dispute.
        if (String(booking.clientId) !== String(actor._id)) {
            throw new ApiError(403, "Not authorized to open a dispute for this booking");
        }

        // Check for existing dispute first (after authorization).
        const existingDispute = await Dispute.findOne({ bookingId });
        if (existingDispute) {
            return existingDispute;
        }

        const session = await mongoose.startSession();
        let dispute;
        try {
            await session.withTransaction(async () => {
                const payment = await Payment.findOne({ bookingId: booking._id }).session(session);
                const earning = await ConsultantEarning.findOne({ bookingId: booking._id }).session(session);

                const created = await Dispute.create([{
                    bookingId: booking._id,
                    paymentId: payment ? payment._id : null,
                    earningId: earning ? earning._id : null,
                    openedBy: actor._id,
                    openedByRole: actor.role || USER_ROLES.BUSINESS_OWNER,
                    reason,
                    status: "OPEN",
                }], { session });
                dispute = created[0];

                if (earning) {
                    if (!earning.disputeId) {
                        earning.disputeId = dispute._id;
                        earning.disputeOpenedAt = new Date();
                    }
                    const earningStatus = earning.status;
                    if (earningStatus === EARNING_STATUS.PAID) {
                        // Do not change status or hold
                    } else if (earningStatus === EARNING_STATUS.IN_PAYOUT) {
                        // Do not change status or hold
                    } else if (earningStatus === EARNING_STATUS.PENDING || earningStatus === EARNING_STATUS.ELIGIBLE) {
                        const prevStatus = earning.status;
                        earning.status = EARNING_STATUS.HELD;
                        earning.holdReason = HOLD_REASON.DISPUTE_OPEN;
                        earning.statusHistory = earning.statusHistory || [];
                        earning.statusHistory.push({
                            from: prevStatus,
                            to: EARNING_STATUS.HELD,
                            changedAt: new Date(),
                            reason: "Dispute opened",
                        });
                    } else if (earningStatus === EARNING_STATUS.HELD) {
                        // Preserve existing hold reason if different; if null set to DISPUTE_OPEN
                        if (!earning.holdReason) {
                            earning.holdReason = HOLD_REASON.DISPUTE_OPEN;
                        }
                    }
                    // ADJUSTED and other statuses: preserve linkage, no unsupported transition
                    await earning.save({ session });
                }
            });
        } finally {
            session.endSession();
        }
        return dispute;
    }

    async resolveDispute(disputeId, { resolution, resolutionNotes, resolutionAmount }, admin) {
        if (!mongoose.Types.ObjectId.isValid(disputeId)) {
            throw new ApiError(400, "Invalid dispute ID");
        }
        if (!admin || !admin._id) {
            throw new ApiError(401, "Authentication required");
        }
        if (admin.role !== USER_ROLES.ADMIN) {
            throw new ApiError(403, "Not authorized to resolve disputes");
        }
        const validResolutions = Object.values(DISPUTE_RESOLUTION);
        if (!validResolutions.includes(resolution)) {
            throw new ApiError(400, "Invalid resolution");
        }
        let amount = resolutionAmount;
        if (resolution === "INCONCLUSIVE_PARTIAL_REFUND") {
            amount = Number(resolutionAmount);
            if (resolutionAmount === undefined || resolutionAmount === null || isNaN(amount) || amount <= 0 || !Number.isFinite(amount)) {
                throw new ApiError(400, "Resolution amount is required for partial refund");
            }
        } else if (resolutionAmount !== undefined && resolutionAmount !== null) {
            throw new ApiError(400, "Resolution amount only allowed for INCONCLUSIVE_PARTIAL_REFUND");
        }

        const session = await mongoose.startSession();
        let dispute;
        try {
            await session.withTransaction(async () => {
                const existing = await Dispute.findById(disputeId).session(session);
                if (!existing) {
                    throw new ApiError(404, "Dispute not found");
                }

                if (existing.status === "RESOLVED") {
                    if (existing.resolution === resolution) {
                        if (resolution === "INCONCLUSIVE_PARTIAL_REFUND" && existing.resolutionAmount !== amount) {
                            throw new ApiError(409, "Dispute already resolved with different amount");
                        }
                        dispute = existing;
                        return;
                    } else {
                        throw new ApiError(409, "Dispute already resolved with different resolution");
                    }
                }
                if (existing.status === "CLOSED") {
                    throw new ApiError(409, "Dispute is closed");
                }
                if (existing.status !== "OPEN" && existing.status !== "UNDER_REVIEW") {
                    throw new ApiError(400, "Dispute cannot be resolved from current status");
                }

                // Validate partial refund amount against remaining refundable balance
                if (resolution === "INCONCLUSIVE_PARTIAL_REFUND") {
                    const payment = existing.paymentId
                        ? await Payment.findById(existing.paymentId).session(session)
                        : await Payment.findOne({ bookingId: existing.bookingId }).session(session);
                    const earning = existing.earningId
                        ? await ConsultantEarning.findById(existing.earningId).session(session)
                        : await ConsultantEarning.findOne({ bookingId: existing.bookingId }).session(session);

                    if (!payment || !earning) {
                        throw new ApiError(400, "Linked payment or earning not found for dispute");
                    }

                    let remainingRefundableAmount;
                    if (earning.grossAmount > 0) {
                        remainingRefundableAmount = earning.grossAmount - (earning.adjustmentAmount || 0);
                    } else {
                        const paymentAmount = payment.amount || 0;
                        const paymentRefunded = payment.refundAmount || 0;
                        remainingRefundableAmount = paymentAmount - paymentRefunded;
                    }

                    if (amount > remainingRefundableAmount) {
                        throw new ApiError(
                            400,
                            `Resolution amount ${amount} exceeds remaining refundable amount ${remainingRefundableAmount}`
                        );
                    }
                }

                existing.status = "RESOLVED";
                existing.resolution = resolution;
                if (resolutionNotes !== undefined) {
                    existing.resolutionNotes = resolutionNotes;
                }
                if (amount !== undefined && amount !== null) {
                    existing.resolutionAmount = amount;
                }
                existing.resolvedBy = admin._id;
                existing.resolvedAt = new Date();
                dispute = await existing.save({ session });
            });
        } finally {
            session.endSession();
        }
        return dispute;
    }

    async claimFinancialProcessing(disputeId, leaseMs = 300000) {
        if (!mongoose.Types.ObjectId.isValid(disputeId)) {
            throw new ApiError(400, "Invalid dispute ID");
        }
        const now = new Date();
        const claimId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const leaseExpiresAt = new Date(now.getTime() + leaseMs);
        const financialLeaseExpiresAt = leaseExpiresAt;

        const maxAttempts = env?.disputeFinancial?.maxAttempts || 5;
        const result = await Dispute.findOneAndUpdate(
            {
                _id: disputeId,
                status: "RESOLVED",
                financialAttempts: { $lt: maxAttempts },
                $or: [
                    { financialStatus: { $in: [null, "none", "pending"] } },
                    { financialStatus: "failed" },
                    { financialStatus: "processing", financialLeaseExpiresAt: { $lt: now } },
                ],
                financialStatus: { $ne: "awaiting_reconciliation" },
            },
            {
                $set: {
                    financialStatus: "processing",
                    financialClaimedAt: now,
                    financialLeaseExpiresAt,
                    financialClaimId: claimId,
                },
                $unset: {
                    financialError: 1,
                },
                $inc: { financialAttempts: 1 },
            },
            { new: true }
        );

        if (!result) {
            return null;
        }
        return { dispute: result, claimId };
    }

    async markFinancialProcessingCompleted(disputeId, claimId, financialReference = null) {
        if (!mongoose.Types.ObjectId.isValid(disputeId)) {
            throw new ApiError(400, "Invalid dispute ID");
        }
        const now = new Date();
        const result = await Dispute.findOneAndUpdate(
            {
                _id: disputeId,
                financialStatus: "processing",
                financialClaimId: claimId,
            },
            {
                $set: {
                    financialStatus: "completed",
                    financialProcessedAt: now,
                    financialReference,
                },
                $unset: {
                    financialClaimId: 1,
                    financialClaimedAt: 1,
                    financialLeaseExpiresAt: 1,
                    financialError: 1,
                },
            },
            { new: true }
        );
        return result;
    }

    async markFinancialProcessingFailed(disputeId, claimId, error) {
        if (!mongoose.Types.ObjectId.isValid(disputeId)) {
            throw new ApiError(400, "Invalid dispute ID");
        }
        const sanitized = error && typeof error.message === "string" ? error.message.slice(0, 200) : "Processing failed";
        const result = await Dispute.findOneAndUpdate(
            {
                _id: disputeId,
                financialStatus: "processing",
                financialClaimId: claimId,
            },
            {
                $set: {
                    financialStatus: "failed",
                    financialError: sanitized,
                },
                $unset: {
                    financialClaimId: 1,
                    financialClaimedAt: 1,
                    financialLeaseExpiresAt: 1,
                },
            },
            { new: true }
        );
        return result;
    }

    async releaseFinancialProcessingLease(disputeId, claimId) {
        if (!mongoose.Types.ObjectId.isValid(disputeId)) {
            throw new ApiError(400, "Invalid dispute ID");
        }
        const result = await Dispute.findOneAndUpdate(
            {
                _id: disputeId,
                status: "RESOLVED",
                financialStatus: "processing",
                financialClaimId: claimId,
            },
            {
                $set: {
                    financialStatus: "completed",
                },
                $unset: {
                    financialClaimId: 1,
                    financialClaimedAt: 1,
                    financialLeaseExpiresAt: 1,
                },
            },
            { new: true }
        );
        return result;
    }

    async applyConsultantWins(disputeId, claimId) {
        if (!mongoose.Types.ObjectId.isValid(disputeId)) {
            throw new ApiError(400, "Invalid dispute ID");
        }

        const session = await mongoose.startSession();
        let result;
        try {
            await session.withTransaction(async () => {
                const dispute = await Dispute.findOne({
                    _id: disputeId,
                    status: "RESOLVED",
                    resolution: "CONSULTANT_WINS",
                    financialStatus: "processing",
                    financialClaimId: claimId,
                }).session(session);

                if (!dispute) {
                    throw new ApiError(404, "Eligible dispute not found for consultant wins processing");
                }

                let earning = null;
                if (dispute.earningId) {
                    earning = await ConsultantEarning.findById(dispute.earningId).session(session);
                }
                if (!earning) {
                    // No linked earning - cannot safely apply hold release; record failure, release claim
                    dispute.financialStatus = "failed";
                    dispute.financialError = "No linked earning found";
                    dispute.financialReference = "CONSULTANT_WINS_NO_EARNING";
                    dispute.financialClaimId = null;
                    dispute.financialClaimedAt = null;
                    dispute.financialLeaseExpiresAt = null;
                    await dispute.save({ session });
                    result = { dispute, earning: null, applied: false, reason: "No linked earning" };
                    return;
                }

                const earningStatus = earning.status;
                if (earningStatus === EARNING_STATUS.PAID || earningStatus === EARNING_STATUS.IN_PAYOUT ||
                    earningStatus === EARNING_STATUS.CANCELLED || earningStatus === EARNING_STATUS.ADJUSTED) {
                    // Do not change these
                    dispute.financialStatus = "failed";
                    dispute.financialError = "Earning status not eligible for hold release";
                    dispute.financialReference = "CONSULTANT_WINS_NO_HOLD_RELEASE";
                    dispute.financialClaimId = null;
                    dispute.financialClaimedAt = null;
                    dispute.financialLeaseExpiresAt = null;
                    await dispute.save({ session });
                    result = { dispute, earning, applied: false, reason: "Earning status not eligible for hold release" };
                    return;
                }

                if (earning.holdReason !== HOLD_REASON.DISPUTE_OPEN) {
                    dispute.financialStatus = "failed";
                    dispute.financialError = "Unrelated hold reason preserved";
                    dispute.financialReference = "CONSULTANT_WINS_UNRELATED_HOLD";
                    dispute.financialClaimId = null;
                    dispute.financialClaimedAt = null;
                    dispute.financialLeaseExpiresAt = null;
                    await dispute.save({ session });
                    result = { dispute, earning, applied: false, reason: "Unrelated hold reason preserved" };
                    return;
                }

                // Try to determine previous status from history
                let prevStatus = null;
                if (Array.isArray(earning.statusHistory) && earning.statusHistory.length > 0) {
                    // Look for most recent transition to HELD with reason "Dispute opened"
                    for (let i = earning.statusHistory.length - 1; i >= 0; i--) {
                        const h = earning.statusHistory[i];
                        if (h.to === EARNING_STATUS.HELD && h.reason === "Dispute opened" && h.from) {
                            prevStatus = h.from;
                            break;
                        }
                    }
                    // If not found, look for last transition to HELD
                    if (!prevStatus) {
                        for (let i = earning.statusHistory.length - 1; i >= 0; i--) {
                            const h = earning.statusHistory[i];
                            if (h.to === EARNING_STATUS.HELD && h.from) {
                                prevStatus = h.from;
                                break;
                            }
                        }
                    }
                }

                if (prevStatus === EARNING_STATUS.PENDING || prevStatus === EARNING_STATUS.ELIGIBLE) {
                    earning.status = prevStatus;
                    earning.holdReason = null;
                    earning.statusHistory.push({
                        from: EARNING_STATUS.HELD,
                        to: prevStatus,
                        changedAt: new Date(),
                        reason: "Dispute resolved: CONSULTANT_WINS",
                    });
                    await earning.save({ session });

                    dispute.financialStatus = "completed";
                    dispute.financialProcessedAt = new Date();
                    dispute.financialReference = "CONSULTANT_WINS_HOLD_RELEASED";
                    dispute.financialClaimId = null;
                    dispute.financialClaimedAt = null;
                    dispute.financialLeaseExpiresAt = null;
                    await dispute.save({ session });
                    result = { dispute, earning, applied: true, reason: `Restored to ${prevStatus}` };
                    return;
                } else {
                    // Cannot safely determine previous status
                    dispute.financialStatus = "failed";
                    dispute.financialProcessedAt = new Date();
                    dispute.financialReference = "CONSULTANT_WINS_PREV_STATUS_UNKNOWN";
                    dispute.financialError = "Previous status cannot be determined safely";
                    dispute.financialClaimId = null;
                    dispute.financialClaimedAt = null;
                    dispute.financialLeaseExpiresAt = null;
                    await dispute.save({ session });
                    result = { dispute, earning, applied: false, reason: "Previous status unknown" };
                    return;
                }
            });
        } finally {
            session.endSession();
        }
        return result;
    }

    async applyCustomerWins(disputeId, claimId) {
        if (!mongoose.Types.ObjectId.isValid(disputeId)) {
            throw new ApiError(400, "Invalid dispute ID");
        }

        const dispute = await Dispute.findOne({
            _id: disputeId,
            status: "RESOLVED",
            resolution: "CUSTOMER_WINS",
            financialStatus: "processing",
            financialClaimId: claimId,
        });

        if (!dispute) {
            throw new ApiError(404, "Eligible dispute not found for customer wins processing");
        }

        const Booking = (await import("../models/Booking.js")).default;
        const Payment = (await import("../models/Payment.js")).default;
        const ConsultantEarning = (await import("../models/ConsultantEarning.js")).default;

        let earning = null;
        if (dispute.earningId) {
            earning = await ConsultantEarning.findById(dispute.earningId);
        }

        if (earning && earning.status === EARNING_STATUS.IN_PAYOUT) {
            dispute.financialStatus = "failed";
            dispute.financialError = "Payout intervention required (IN_PAYOUT)";
            dispute.financialReference = "CUSTOMER_WINS_IN_PAYOUT";
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: false, reason: "IN_PAYOUT requires intervention" };
        }

        const booking = await Booking.findById(dispute.bookingId);
        const payment = await Payment.findOne({ bookingId: dispute.bookingId });

        if (!booking || !payment) {
            dispute.financialStatus = "failed";
            dispute.financialError = "Missing booking or payment";
            dispute.financialReference = "CUSTOMER_WINS_MISSING_RECORDS";
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: false, reason: "Missing records" };
        }

        const refundReference = `DISP-${disputeId}`;
        const refundService = (await import("./refund.service.js")).default;

        try {
                const disputeRefundAmount = (payment.consultationFeeAmount !== undefined && payment.consultationFeeAmount !== null)
                    ? payment.consultationFeeAmount
                    : payment.amount;
                const refundResult = await refundService.processRefundWithPaystack({
                    paymentId: payment._id,
                    bookingId: booking._id,
                    refundReference,
                    refundAmount: disputeRefundAmount,
                    reason: "DISPUTE_RESOLUTION",
                adminId: dispute.resolvedBy || dispute.openedBy,
            });

            if (refundResult && refundResult.pending) {
                dispute.financialStatus = "awaiting_reconciliation";
                dispute.financialError = refundResult.reason || "Refund pending reconciliation - requires reconciliation";
                dispute.financialReference = refundReference;
                dispute.financialClaimId = null;
                dispute.financialClaimedAt = null;
                dispute.financialLeaseExpiresAt = null;
                await dispute.save();
                return { dispute, applied: false, reason: "Awaiting reconciliation" };
            }

            dispute.financialStatus = "completed";
            dispute.financialProcessedAt = new Date();
            dispute.financialReference = refundReference;
            dispute.financialError = null;
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: true, refundResult };
        } catch (error) {
            // Check if there's a pending refund that needs reconciliation
            const pendingPayment = await Payment.findOne({
                _id: payment._id,
                refundReference,
                refundStatus: "pending",
            });
            if (pendingPayment) {
                dispute.financialStatus = "awaiting_reconciliation";
                dispute.financialError = "Refund pending reconciliation - requires manual reconciliation";
                dispute.financialReference = refundReference;
                dispute.financialClaimId = null;
                dispute.financialClaimedAt = null;
                dispute.financialLeaseExpiresAt = null;
                await dispute.save();
                return { dispute, applied: false, reason: "Awaiting reconciliation" };
            }
            dispute.financialStatus = "failed";
            dispute.financialError = error && error.message ? error.message.slice(0, 200) : "Refund failed";
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: false, error: dispute.financialError };
        }
    }

    async applyInconclusivePartialRefund(disputeId, claimId) {
        if (!mongoose.Types.ObjectId.isValid(disputeId)) {
            throw new ApiError(400, "Invalid dispute ID");
        }

        const dispute = await Dispute.findOne({
            _id: disputeId,
            status: "RESOLVED",
            resolution: "INCONCLUSIVE_PARTIAL_REFUND",
            financialStatus: "processing",
            financialClaimId: claimId,
        });

        if (!dispute) {
            throw new ApiError(404, "Eligible dispute not found for partial refund processing");
        }

        const amount = dispute.resolutionAmount;
        if (amount === undefined || amount === null || isNaN(Number(amount)) || Number(amount) <= 0 || !Number.isFinite(Number(amount))) {
            dispute.financialStatus = "failed";
            dispute.financialError = "Invalid or missing approved resolution amount";
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: false, reason: "Invalid approved amount" };
        }

        const approvedAmount = Number(amount);

        const Booking = (await import("../models/Booking.js")).default;
        const Payment = (await import("../models/Payment.js")).default;
        const ConsultantEarning = (await import("../models/ConsultantEarning.js")).default;

        let earning = null;
        if (dispute.earningId) {
            earning = await ConsultantEarning.findById(dispute.earningId);
        }

        if (earning && earning.status === EARNING_STATUS.IN_PAYOUT) {
            dispute.financialStatus = "failed";
            dispute.financialError = "Payout intervention required (IN_PAYOUT)";
            dispute.financialReference = "PARTIAL_REFUND_IN_PAYOUT";
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: false, reason: "IN_PAYOUT requires intervention" };
        }

        const booking = await Booking.findById(dispute.bookingId);
        const payment = await Payment.findOne({ bookingId: dispute.bookingId });

        if (!booking || !payment) {
            dispute.financialStatus = "failed";
            dispute.financialError = "Missing booking or payment";
            dispute.financialReference = "PARTIAL_REFUND_MISSING_RECORDS";
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: false, reason: "Missing records" };
        }

        if (String(payment.bookingId) !== String(booking._id)) {
            dispute.financialStatus = "failed";
            dispute.financialError = "Payment does not belong to booking";
            dispute.financialReference = "PARTIAL_REFUND_PAYMENT_MISMATCH";
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: false, reason: "Payment/booking mismatch" };
        }

        if (!earning) {
            dispute.financialStatus = "failed";
            dispute.financialError = "Missing consultant earning";
            dispute.financialReference = "PARTIAL_REFUND_MISSING_EARNING";
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: false, reason: "Missing earning" };
        }

        if (payment.status !== "success") {
            dispute.financialStatus = "failed";
            dispute.financialError = "Payment not eligible for refund";
            dispute.financialReference = "PARTIAL_REFUND_PAYMENT_NOT_ELIGIBLE";
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: false, reason: "Payment not eligible" };
        }

        let remainingRefundableAmount;
        if (earning.grossAmount > 0) {
            remainingRefundableAmount = earning.grossAmount - (earning.adjustmentAmount || 0);
        } else {
            const paymentAmount = payment.amount || 0;
            const paymentRefunded = payment.refundAmount || 0;
            remainingRefundableAmount = paymentAmount - paymentRefunded;
        }

        if (approvedAmount > remainingRefundableAmount) {
            dispute.financialStatus = "failed";
            dispute.financialError = "Approved amount exceeds remaining refundable balance";
            dispute.financialReference = "PARTIAL_REFUND_EXCEEDS_REMAINING";
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: false, reason: "Amount exceeds remaining" };
        }

        const refundReference = `DISP-${disputeId}`;
        const refundService = (await import("./refund.service.js")).default;

        try {
            const refundResult = await refundService.processRefundWithPaystack({
                paymentId: payment._id,
                bookingId: booking._id,
                refundReference,
                refundAmount: approvedAmount,
                reason: "DISPUTE_RESOLUTION",
                adminId: dispute.resolvedBy || dispute.openedBy,
            });

            if (refundResult && refundResult.pending) {
                dispute.financialStatus = "awaiting_reconciliation";
                dispute.financialError = refundResult.reason || "Refund pending reconciliation - requires reconciliation";
                dispute.financialReference = refundReference;
                dispute.financialClaimId = null;
                dispute.financialClaimedAt = null;
                dispute.financialLeaseExpiresAt = null;
                await dispute.save();
                return { dispute, applied: false, reason: "Awaiting reconciliation" };
            }

            dispute.financialStatus = "completed";
            dispute.financialProcessedAt = new Date();
            dispute.financialReference = refundReference;
            dispute.financialError = null;
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: true, refundResult };
        } catch (error) {
            const pendingPayment = await Payment.findOne({
                _id: payment._id,
                refundReference,
                refundStatus: "pending",
            });
            if (pendingPayment) {
                dispute.financialStatus = "awaiting_reconciliation";
                dispute.financialError = "Refund pending reconciliation - requires reconciliation";
                dispute.financialReference = refundReference;
                dispute.financialClaimId = null;
                dispute.financialClaimedAt = null;
                dispute.financialLeaseExpiresAt = null;
                await dispute.save();
                return { dispute, applied: false, reason: "Awaiting reconciliation" };
            }
            dispute.financialStatus = "failed";
            dispute.financialError = error && error.message ? error.message.slice(0, 200) : "Refund failed";
            dispute.financialClaimId = null;
            dispute.financialClaimedAt = null;
            dispute.financialLeaseExpiresAt = null;
            await dispute.save();
            return { dispute, applied: false, error: dispute.financialError };
        }
    }

    async finalizeDisputeFromReconciliation(refundReference) {
        if (!refundReference) return null;
        const dispute = await Dispute.findOne({
            financialReference: refundReference,
            resolution: { $in: ["CUSTOMER_WINS", "INCONCLUSIVE_PARTIAL_REFUND"] },
            financialStatus: "awaiting_reconciliation",
        });
        if (!dispute) return null;

        // Idempotent: already finalized, return without mutation.
        if (dispute.financialStatus === "completed") {
            return dispute;
        }

        // Verify the linked payment exists and matches the dispute context.
        if (!dispute.paymentId) {
            return null;
        }
        const Payment = (await import("../models/Payment.js")).default;
        const payment = await Payment.findById(dispute.paymentId);
        if (!payment) {
            return null;
        }

        // Verify the refund reference matches the persisted payment reference.
        if (payment.refundReference !== refundReference) {
            return null;
        }

        // Reject payments whose refund has definitively failed or never started.
        if (payment.refundStatus === "failed" || payment.refundStatus === "none") {
            return null;
        }

        // Full refund path: payment.refundStatus === "completed" is sufficient.
        // The payment was fully refunded and verified by Paystack.
        if (payment.refundStatus === "completed") {
            // No further verification needed for full refunds.
        } else if (payment.refundStatus === "pending") {
            // Partial refund path: payment.refundStatus remains "pending" even after
            // successful reconciliation. We need authoritative evidence that the
            // specific refund was applied locally. Use the earning's refundHistory.
            if (!dispute.earningId) {
                return null;
            }
            const ConsultantEarning = (await import("../models/ConsultantEarning.js")).default;
            const earning = await ConsultantEarning.findById(dispute.earningId);
            if (!earning) {
                return null;
            }

            // Find a refundHistory entry with matching refundReference.
            const matchingEntry = (earning.refundHistory || []).find(
                (entry) => entry.refundReference === refundReference
            );
            if (!matchingEntry) {
                return null;
            }

            // Verify the individual refund amount matches the dispute's resolution amount.
            // Use the per-entry refundAmount, NOT the cumulative payment.refundAmount.
            const resolutionAmount = dispute.resolutionAmount;
            if (
                resolutionAmount === undefined ||
                resolutionAmount === null ||
                !Number.isFinite(Number(resolutionAmount)) ||
                Number(resolutionAmount) <= 0
            ) {
                // For CUSTOMER_WINS (full refund), resolutionAmount may be null.
                // In that case, accept any matching history entry.
                if (dispute.resolution !== "CUSTOMER_WINS") {
                    return null;
                }
            } else {
                if (Number(matchingEntry.refundAmount) !== Number(resolutionAmount)) {
                    return null;
                }
            }
        } else {
            // Unknown refundStatus — fail closed.
            return null;
        }

        dispute.financialStatus = "completed";
        dispute.financialProcessedAt = new Date();
        dispute.financialError = null;
        dispute.financialClaimId = null;
        dispute.financialClaimedAt = null;
        dispute.financialLeaseExpiresAt = null;
        await dispute.save();
        return dispute;
    }

    async processDisputeFinancialResolution(disputeId, { leaseMs = 300000 } = {}) {
        const claimResult = await this.claimFinancialProcessing(disputeId, leaseMs);
        if (!claimResult) {
            return { claimed: false, reason: "not_claimable" };
        }

        const { dispute, claimId } = claimResult;
        const resolution = dispute.resolution;

        const supported = ["CONSULTANT_WINS", "CUSTOMER_WINS", "INCONCLUSIVE_PARTIAL_REFUND"];
        if (!resolution || !supported.includes(resolution)) {
            await this.releaseFinancialProcessingLease(disputeId, claimId);
            return {
                claimed: true,
                executed: false,
                reason: "unsupported_resolution",
                resolution,
            };
        }

        if (resolution === "CONSULTANT_WINS") {
            return await this.applyConsultantWins(disputeId, claimId);
        }
        if (resolution === "CUSTOMER_WINS") {
            return await this.applyCustomerWins(disputeId, claimId);
        }
        if (resolution === "INCONCLUSIVE_PARTIAL_REFUND") {
            return await this.applyInconclusivePartialRefund(disputeId, claimId);
        }

        await this.releaseFinancialProcessingLease(disputeId, claimId);
        return {
            claimed: true,
            executed: false,
            reason: "unsupported_resolution",
            resolution,
        };
    }
}

export default new DisputeService();