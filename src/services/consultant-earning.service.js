import mongoose from "mongoose";

import ConsultantEarning from "../models/ConsultantEarning.js";
import Booking from "../models/Booking.js";
import ConsultationSession from "../models/ConsultationSession.js";
import Payment from "../models/Payment.js";
import ConsultantProfile from "../models/ConsultantProfile.js";
import ApiError from "../utils/ApiError.js";
import {
    USER_ROLES,
    SESSION_OUTCOME,
    EARNING_STATUS,
    HOLD_REASON,
    PLATFORM_COMMISSION_RATE,
} from "../utils/constants.js";

// ---------------------------------------------------------------------------
// Commission Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate earning amounts from gross amount.
 * All amounts are in kobo (integer).
 * @param {number} grossAmount - Gross amount in kobo
 * @returns {object} Calculated amounts
 */
function calculateEarning(grossAmount) {
    const platformCommission = Math.round(grossAmount * PLATFORM_COMMISSION_RATE.DEFAULT);
    const consultantEntitlement = grossAmount - platformCommission;

    return {
        grossAmount,
        platformCommission,
        consultantEntitlement,
        platformCommissionRate: PLATFORM_COMMISSION_RATE.DEFAULT,
    };
}

// ---------------------------------------------------------------------------
// Session Outcome Mapping
// ---------------------------------------------------------------------------

/**
 * Determine earning details from session outcome.
 * @param {string} sessionOutcome - The session outcome
 * @param {number} grossAmount - Gross amount in kobo
 * @returns {object} Earning details
 */
function determineEarningFromSessionOutcome(sessionOutcome, grossAmount) {
    const calculations = {
        [SESSION_OUTCOME.COMPLETED]: {
            ...calculateEarning(grossAmount),
            status: EARNING_STATUS.PENDING,
            holdReason: null,
        },
        [SESSION_OUTCOME.CUSTOMER_INSUFFICIENT]: {
            ...calculateEarning(grossAmount),
            status: EARNING_STATUS.PENDING,
            holdReason: null,
        },
        // For outcomes where customer gets full refund, grossAmount is 0
        // (no money was actually earned; original amount preserved in Booking/Payment)
        [SESSION_OUTCOME.CONSULTANT_INSUFFICIENT]: {
            grossAmount: 0,
            consultantEntitlement: 0,
            platformCommission: 0,
            platformCommissionRate: PLATFORM_COMMISSION_RATE.DEFAULT,
            status: EARNING_STATUS.CANCELLED,
            holdReason: null,
        },
        [SESSION_OUTCOME.NEITHER_MET]: {
            grossAmount: 0,
            consultantEntitlement: 0,
            platformCommission: 0,
            platformCommissionRate: PLATFORM_COMMISSION_RATE.DEFAULT,
            status: EARNING_STATUS.HELD,
            holdReason: HOLD_REASON.NEITHER_MET_INVESTIGATION,
        },
        [SESSION_OUTCOME.CONSULTANT_CANCELLED]: {
            grossAmount: 0,
            consultantEntitlement: 0,
            platformCommission: 0,
            platformCommissionRate: PLATFORM_COMMISSION_RATE.DEFAULT,
            status: EARNING_STATUS.CANCELLED,
            holdReason: null,
        },
        [SESSION_OUTCOME.CONSULTANT_NO_SHOW]: {
            grossAmount: 0,
            consultantEntitlement: 0,
            platformCommission: 0,
            platformCommissionRate: PLATFORM_COMMISSION_RATE.DEFAULT,
            status: EARNING_STATUS.CANCELLED,
            holdReason: null,
        },
        [SESSION_OUTCOME.CUSTOMER_NO_SHOW]: {
            ...calculateEarning(grossAmount),
            status: EARNING_STATUS.PENDING,
            holdReason: null,
        },
    };

    return calculations[sessionOutcome];
}

// ---------------------------------------------------------------------------
// Service Class
// ---------------------------------------------------------------------------

class ConsultantEarningService {

    // -----------------------------------------------------------------------
    // Role-Based Serialization
    // -----------------------------------------------------------------------

    /**
     * Fields allowed for consultant-facing responses (after session).
     * Consultants can see their entitlement but not platform financials.
     */
    CONSULTANT_ALLOWED_FIELDS = new Set([
        "_id",
        "status",
        "sessionOutcome",
        "consultantEntitlement",
        "eligibleAt",
        "paidAt",
        "createdAt",
    ]);

    /**
     * Serialize a single earning document for a specific user role.
     * Does NOT mutate the original Mongoose document.
     *
     * @param {object} earning - Mongoose document or plain object
     * @param {string} userRole - The requester's role
     * @returns {object} Serialized plain object
     */
    serializeForRole(earning, userRole) {
        if (userRole === USER_ROLES.ADMIN) {
            // Admin sees all fields — return a plain copy to prevent mutation
            return earning.toObject ? earning.toObject() : { ...earning };
        }

        if (userRole === USER_ROLES.CONSULTANT) {
            const plain = earning.toObject ? earning.toObject() : { ...earning };
            const filtered = {};
            for (const key of this.CONSULTANT_ALLOWED_FIELDS) {
                if (plain[key] !== undefined) {
                    filtered[key] = plain[key];
                }
            }
            return filtered;
        }

        // Default: minimal safe fields for unknown roles
        const plain = earning.toObject ? earning.toObject() : { ...earning };
        return {
            _id: plain._id,
            status: plain.status,
            sessionOutcome: plain.sessionOutcome,
            createdAt: plain.createdAt,
        };
    }

    /**
     * Serialize an array of earning documents for a specific user role.
     * Does NOT mutate the original Mongoose documents.
     *
     * @param {Array} earnings - Array of Mongoose documents or plain objects
     * @param {string} userRole - The requester's role
     * @returns {Array} Array of serialized plain objects
     */
    serializeManyForRole(earnings, userRole) {
        return earnings.map((earning) =>
            this.serializeForRole(earning, userRole)
        );
    }

    // -----------------------------------------------------------------------
    // Earning Creation
    // -----------------------------------------------------------------------

    /**
     * Create a ConsultantEarning from a completed/eligible consultation session.
     *
     * @param {string} bookingId - The booking ID
     * @param {string} sessionOutcome - The session outcome
     * @returns {Promise<object>} The created or existing earning
     * @throws {ApiError} If booking, session, or payment not found
     */
    async createEarningFromSession(bookingId, sessionOutcome) {
        // Validate session outcome
        if (!Object.values(SESSION_OUTCOME).includes(sessionOutcome)) {
            throw new ApiError(400, `Invalid session outcome: ${sessionOutcome}`);
        }

        // Start a session for transaction support
        const mongoSession = await mongoose.startSession();

        try {
            // Use transaction for atomicity
            const result = await mongoSession.withTransaction(async () => {
                // 1. Load the booking
                const booking = await Booking.findById(bookingId).session(mongoSession);
                if (!booking) {
                    throw new ApiError(404, "Booking not found");
                }

                // 2. Load the consultation session
                const consultationSession = await ConsultationSession.findOne({ bookingId }).session(mongoSession);
                if (!consultationSession) {
                    throw new ApiError(404, "Consultation session not found");
                }

                // 3. Load the payment (find successful payment for this booking)
                const payment = await Payment.findOne({
                    bookingId,
                    status: "success",
                }).session(mongoSession);

                if (!payment) {
                    throw new ApiError(404, "Successful payment not found for this booking");
                }

                // 4. Load the consultant profile
                const consultantProfile = await ConsultantProfile.findById(booking.consultantProfileId).session(mongoSession);
                if (!consultantProfile) {
                    throw new ApiError(404, "Consultant profile not found");
                }

                // 5. Check for existing earning (idempotency check within transaction)
                const existingEarning = await ConsultantEarning.findOne({ bookingId }).session(mongoSession);
                if (existingEarning) {
                    return { earning: existingEarning, created: false };
                }

                // 6. Determine financial outcome from session outcome
                const grossAmount = booking.amount;
                const earningDetails = determineEarningFromSessionOutcome(sessionOutcome, grossAmount);

                // 7. Set eligibleAt to 24 hours after creation for PENDING earnings.
                //    EarningEligibilityService.markEligibleEarnings() transitions PENDING
                //    earnings to ELIGIBLE only when eligibleAt <= now.
                const isPendingStatus = earningDetails.status === EARNING_STATUS.PENDING;
                const eligibleAt = isPendingStatus
                    ? new Date(Date.now() + 24 * 60 * 60 * 1000)
                    : null;

                // 8. Create the earning
                const earning = await ConsultantEarning.create([{
                    bookingId: booking._id,
                    paymentId: payment._id,
                    consultantId: booking.consultantId,
                    consultantProfileId: booking.consultantProfileId,
                    clientId: booking.clientId,
                    sessionId: consultationSession._id,
                    grossAmount: earningDetails.grossAmount,
                    platformCommission: earningDetails.platformCommission,
                    consultantEntitlement: earningDetails.consultantEntitlement,
                    platformCommissionRate: earningDetails.platformCommissionRate,
                    sessionOutcome,
                    status: earningDetails.status,
                    holdReason: earningDetails.holdReason,
                    eligibleAt,
                }], { session: mongoSession });

                return { earning: earning[0], created: true };
            });

            return result;
        } catch (error) {
            // Handle duplicate key error (idempotency - concurrent request)
            if (error.code === 11000) {
                // Another request created the earning, fetch and return it
                const existingEarning = await ConsultantEarning.findOne({ bookingId });
                if (existingEarning) {
                    return { earning: existingEarning, created: false };
                }
            }

            // Re-throw ApiError instances
            if (error instanceof ApiError) {
                throw error;
            }

            // Wrap other errors
            throw new ApiError(500, `Failed to create earning: ${error.message}`);
        } finally {
            mongoSession.endSession();
        }
    }

    /**
     * Cancel an existing earning for a booking.
     * Used when a booking is cancelled after an earning was already created.
     *
     * Earnings that are already IN_PAYOUT or PAID cannot be cancelled because
     * the payout process has already begun or completed. Attempting to cancel
     * such earnings would create inconsistent financial state.
     *
     * @param {string} bookingId - The booking ID
     * @returns {Promise<object>} The cancelled earning or null if not found
     * @throws {ApiError} If the earning is in IN_PAYOUT or PAID status
     */
    async cancelEarningForBooking(bookingId) {
        const earning = await ConsultantEarning.findOne({ bookingId });

        if (!earning) {
            return null;
        }

        // Status guard: earnings in IN_PAYOUT or PAID status have already
        // entered the payout lifecycle and cannot be cancelled.
        if (earning.status === EARNING_STATUS.IN_PAYOUT) {
            throw new ApiError(
                400,
                `Cannot cancel earning in ${earning.status} status. The payout is already in progress.`
            );
        }

        if (earning.status === EARNING_STATUS.PAID) {
            throw new ApiError(
                400,
                `Cannot cancel earning in ${earning.status} status. The consultant has already been paid.`
            );
        }

        earning.status = EARNING_STATUS.CANCELLED;
        earning.holdReason = null;

        await earning.save();

        return earning;
    }

    /**
     * Get an earning by booking ID.
     * @param {string} bookingId - The booking ID
     * @param {string} [userRole] - Optional requester role for serialization
     * @returns {Promise<object>} The earning (serialized if userRole provided)
     * @throws {ApiError} If earning not found
     */
    async getEarningByBookingId(bookingId, userRole = null) {
        const earning = await ConsultantEarning.findOne({ bookingId });

        if (!earning) {
            throw new ApiError(404, "Earning not found for this booking");
        }

        if (userRole) {
            return this.serializeForRole(earning, userRole);
        }

        return earning;
    }

    /**
     * Get earnings by consultant ID.
     * @param {string} consultantId - The consultant ID
     * @param {string} [status] - Optional status filter
     * @param {string} [userRole] - Optional requester role for serialization
     * @returns {Promise<Array>} Array of earnings (serialized if userRole provided)
     */
    async getEarningsByConsultantId(consultantId, status = null, userRole = null) {
        const query = { consultantId };

        if (status) {
            query.status = status;
        }

        const earnings = await ConsultantEarning.find(query).sort({ createdAt: -1 });

        if (userRole) {
            return this.serializeManyForRole(earnings, userRole);
        }

        return earnings;
    }

    /**
     * Mark eligible earnings as ELIGIBLE.
     * Transitions PENDING earnings whose eligibleAt has passed to ELIGIBLE status.
     * Uses atomic update to prevent duplicate processing.
     * @param {Date} [beforeDate] - Optional cutoff date (defaults to now)
     * @returns {Promise<number>} Number of earnings transitioned
     */
    async markEligibleEarnings(beforeDate = null) {
        const now = beforeDate || new Date();

        const result = await ConsultantEarning.updateMany(
            {
                status: EARNING_STATUS.PENDING,
                eligibleAt: { $lte: now },
            },
            {
                $set: { status: EARNING_STATUS.ELIGIBLE },
                $push: {
                    statusHistory: {
                        from: EARNING_STATUS.PENDING,
                        to: EARNING_STATUS.ELIGIBLE,
                        changedAt: now,
                        reason: "24-hour eligibility period passed",
                    },
                },
            }
        );

        return result.modifiedCount;
    }

    /**
     * Get an earning by ID.
     * @param {string} earningId - The earning ID
     * @returns {Promise<object|null>} The earning or null
     */
    async getEarningById(earningId) {
        return await ConsultantEarning.findById(earningId);
    }

    /**
     * Get all earnings (admin).
     * @param {object} options - Query options
     * @param {string} [options.status] - Optional status filter
     * @param {string} [options.page] - Page number
     * @param {string} [options.limit] - Items per page
     * @param {string} [userRole] - Optional requester role for serialization
     * @returns {Promise<object>} Paginated results
     */
    async getAllEarnings({ status, page, limit } = {}, userRole = null) {
        const query = {};

        if (status) {
            query.status = status;
        }

        const pageNum = page ? parseInt(page, 10) : 1;
        const limitNum = limit ? parseInt(limit, 10) : 20;
        const skip = (pageNum - 1) * limitNum;

        const [earnings, total] = await Promise.all([
            ConsultantEarning.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
            ConsultantEarning.countDocuments(query),
        ]);

        const result = {
            earnings,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                pages: Math.ceil(total / limitNum),
            },
        };

        if (userRole) {
            result.earnings = this.serializeManyForRole(earnings, userRole);
        }

        return result;
    }

    /**
     * Check if an earning exists for a booking.
     * @param {string} bookingId - The booking ID
     * @returns {Promise<boolean>} True if earning exists
     */
    async earningExists(bookingId) {
        const count = await ConsultantEarning.countDocuments({ bookingId });
        return count > 0;
    }
}

// ---------------------------------------------------------------------------
// Export Singleton
// ---------------------------------------------------------------------------

export default new ConsultantEarningService();
