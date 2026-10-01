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
    BOOKING_STATUS,
    APP_TIMEZONE,
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

    // -----------------------------------------------------------------------
    // Lagos Timezone Helpers
    // -----------------------------------------------------------------------

    /**
     * Convert an inclusive Lagos calendar date string (YYYY-MM-DD) to a UTC
     * Date representing the start of that day in Lagos time.
     *
     * Lagos is Africa/Lagos (UTC+1, no DST). Lagos midnight (00:00:00) on a
     * given calendar date corresponds to 23:00:00 UTC on the previous day.
     *
     * @param {string} dateStr - Date string in YYYY-MM-DD format
     * @returns {Date} UTC Date at Lagos midnight for the given date
     */
    _lagosDateToUTC(dateStr) {
        const [year, month, day] = dateStr.split("-").map(Number);
        // month is 1-based in YYYY-MM-DD; Date.UTC expects 0-based month
        // Lagos is UTC+1, so Lagos 00:00:00 = UTC 23:00:00 of the previous day
        const utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);
        return new Date(utcMidnight - 1 * 60 * 60 * 1000);
    }

    /**
     * Validate a YYYY-MM-DD date string.
     * @param {string} dateStr - Date string to validate
     * @throws {ApiError} If the date is malformed or impossible
     */
    _validateLagosDate(dateStr, fieldName = "date") {
        if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            throw new ApiError(400, `Invalid ${fieldName} format. Expected YYYY-MM-DD.`);
        }

        const [year, month, day] = dateStr.split("-").map(Number);

        if (month < 1 || month > 12) {
            throw new ApiError(400, `Invalid ${fieldName}: month must be between 01 and 12.`);
        }

        // Check for impossible dates (e.g., Feb 31)
        const testDate = new Date(Date.UTC(year, month - 1, day));
        if (
            testDate.getUTCFullYear() !== year ||
            testDate.getUTCMonth() !== month - 1 ||
            testDate.getUTCDate() !== day
        ) {
            throw new ApiError(400, `Invalid ${fieldName}: ${dateStr} is not a valid calendar date.`);
        }
    }

    /**
     * Build MongoDB createdAt date-range filter from optional Lagos calendar
     * date strings.
     *
     * Semantics:
     *   - `from` is inclusive: createdAt >= Lagos from-date 00:00:00
     *   - `to` is inclusive: createdAt < Lagos day-after-to-date 00:00:00
     *
     * @param {string|null} [from] - Inclusive start date (YYYY-MM-DD, Lagos)
     * @param {string|null} [to] - Inclusive end date (YYYY-MM-DD, Lagos)
     * @returns {object|null} MongoDB date-range filter or null if no dates provided
     */
    _buildDateRangeFilter(from, to) {
        if (!from && !to) {
            return null;
        }

        const filter = {};

        if (from) {
            this._validateLagosDate(from, "from");
            filter.$gte = this._lagosDateToUTC(from);
        }

        if (to) {
            this._validateLagosDate(to, "to");
            // Exclusive upper bound: Lagos midnight of the day after `to`
            const [year, month, day] = to.split("-").map(Number);
            const nextDay = new Date(Date.UTC(year, month - 1, day));
            nextDay.setUTCDate(nextDay.getUTCDate() + 1);
            const nextDayStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
            filter.$lt = this._lagosDateToUTC(nextDayStr);
        }

        // Validate from > to
        if (from && to) {
            const fromUTC = this._lagosDateToUTC(from);
            const [year, month, day] = to.split("-").map(Number);
            const nextDay = new Date(Date.UTC(year, month - 1, day));
            nextDay.setUTCDate(nextDay.getUTCDate() + 1);
            const nextDayStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
            const toExclusive = this._lagosDateToUTC(nextDayStr);

            if (fromUTC >= toExclusive) {
                throw new ApiError(400, "Invalid date range: from date must be before to date.");
            }
        }

        return filter;
    }

    /**
     * Get earnings by consultant ID with optional pagination.
     *
     * @param {string} consultantId - The consultant ID
     * @param {string} [status] - Optional status filter
     * @param {string} [from] - Optional inclusive start date (YYYY-MM-DD, Lagos)
     * @param {string} [to] - Optional inclusive end date (YYYY-MM-DD, Lagos)
     * @param {number} [page] - Optional page number (1-based)
     * @param {number} [limit] - Optional page size
     * @param {string} [userRole] - Optional requester role for serialization
     * @returns {Promise<object>} Paginated result with earnings array and pagination metadata
     */
    async getEarningsByConsultantId(consultantId, status = null, from = null, to = null, page = 1, limit = 10, userRole = null) {
        const query = { consultantId };

        if (status) {
            query.status = status;
        }

        // Apply Lagos timezone date-range filter
        const dateRangeFilter = this._buildDateRangeFilter(from, to);
        if (dateRangeFilter) {
            query.createdAt = dateRangeFilter;
        }

        // Pagination defaults and bounds
        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 10));
        const skip = (pageNum - 1) * limitNum;

        // Stable sort: createdAt descending, then _id descending as tiebreaker
        const sort = { createdAt: -1, _id: -1 };

        // Fetch page and total count in parallel
        const [earnings, total] = await Promise.all([
            ConsultantEarning.find(query).sort(sort).skip(skip).limit(limitNum),
            ConsultantEarning.countDocuments(query),
        ]);

        const pages = total > 0 ? Math.ceil(total / limitNum) : 0;

        const result = {
            earnings,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                pages,
            },
        };

        if (userRole) {
            result.earnings = this.serializeManyForRole(earnings, userRole);
        }

        return result;
    }

    // -----------------------------------------------------------------------
    // Export
    // -----------------------------------------------------------------------

    /**
     * Format a Date or ISO string as a human-readable date in Lagos timezone.
     * Example: "Sep 15, 2026"
     * @param {Date|string|null} date - The date to format
     * @returns {string} Formatted date string or empty string if null/undefined
     */
    _formatDateForExport(date) {
        if (!date) return "";
        const d = date instanceof Date ? date : new Date(date);
        if (isNaN(d.getTime())) return "";
        return d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: APP_TIMEZONE,
        });
    }

    /**
     * Format an amount in kobo as Nigerian naira string.
     * Example: 500000 -> "5,000.00"
     * @param {number} kobo - Amount in kobo
     * @returns {string} Formatted naira string
     */
    _formatKoboToNaira(kobo) {
        if (typeof kobo !== "number" || isNaN(kobo)) return "0.00";
        const naira = kobo / 100;
        return naira.toLocaleString("en-NG", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });
    }

    /**
     * Escape a value for safe CSV output.
     * Handles commas, quotes, newlines, and formula injection.
     *
     * @param {string|null|undefined} value - The value to escape
     * @returns {string} Safely escaped CSV cell value
     */
    _escapeCsvValue(value) {
        if (value === null || value === undefined) return "";

        const str = String(value);

        // Prevent spreadsheet formula injection
        const formulaPrefixes = ["=", "+", "-", "@"];
        const firstChar = str.charAt(0);
        if (formulaPrefixes.includes(firstChar)) {
            return `'${str}`;
        }

        // If the value contains comma, quote, or newline, wrap in quotes
        // and double any internal quotes
        if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
            return `"${str.replace(/"/g, '""')}"`;
        }

        return str;
    }

    /**
     * Generate a CSV string from an array of serialized consultant earnings.
     *
     * @param {Array} earnings - Array of serialized consultant earnings
     * @returns {string} CSV string with BOM
     */
    _generateCsv(earnings) {
        const headers = [
            "ID",
            "Date",
            "Status",
            "Session Outcome",
            "Amount (₦)",
            "Eligible At",
            "Paid At",
        ];

        const rows = earnings.map((e) => {
            return [
                this._escapeCsvValue(e._id),
                this._escapeCsvValue(this._formatDateForExport(e.createdAt)),
                this._escapeCsvValue(e.status),
                this._escapeCsvValue(e.sessionOutcome),
                this._escapeCsvValue(this._formatKoboToNaira(e.consultantEntitlement)),
                this._escapeCsvValue(this._formatDateForExport(e.eligibleAt)),
                this._escapeCsvValue(this._formatDateForExport(e.paidAt)),
            ].join(",");
        });

        const csvContent = [headers.join(","), ...rows].join("\n");
        // Add UTF-8 BOM for Excel compatibility
        return "\uFEFF" + csvContent;
    }

    /**
     * Export all earnings for a consultant matching the given filters.
     * Returns a CSV string with consultant-safe fields only.
     *
     * @param {string} consultantId - The consultant ID
     * @param {object} filters - Export filters
     * @param {string} [filters.status] - Optional status filter
     * @param {string} [filters.from] - Optional inclusive start date (YYYY-MM-DD, Lagos)
     * @param {string} [filters.to] - Optional inclusive end date (YYYY-MM-DD, Lagos)
     * @returns {Promise<string>} CSV string with BOM
     */
    async exportEarningsByConsultantId(consultantId, { status = null, from = null, to = null } = {}) {
        const query = { consultantId };

        if (status) {
            query.status = status;
        }

        // Apply Lagos timezone date-range filter (reuses existing logic)
        const dateRangeFilter = this._buildDateRangeFilter(from, to);
        if (dateRangeFilter) {
            query.createdAt = dateRangeFilter;
        }

        // Fetch ALL matching records (no pagination, no limit)
        const sort = { createdAt: -1, _id: -1 };
        const earnings = await ConsultantEarning.find(query).sort(sort);

        // Serialize for consultant role (enforces privacy allowlist)
        const serialized = this.serializeManyForRole(earnings, USER_ROLES.CONSULTANT);

        // Generate CSV
        return this._generateCsv(serialized);
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

        // Find all PENDING earnings whose eligibility period has passed.
        const eligibleEarnings = await ConsultantEarning.find({
            status: EARNING_STATUS.PENDING,
            eligibleAt: { $lte: now },
        });

        if (eligibleEarnings.length === 0) {
            return 0;
        }

        // Load associated bookings to verify they are still valid.
        const bookingIds = [...new Set(eligibleEarnings.map((e) => String(e.bookingId)))];
        const bookings = await Booking.find({
            _id: { $in: bookingIds.map((id) => new mongoose.Types.ObjectId(id)) },
        });
        const cancelledBookingIds = new Set(
            bookings
                .filter((b) => b.status === BOOKING_STATUS.CANCELLED)
                .map((b) => String(b._id))
        );

        // Filter out earnings whose bookings have been cancelled.
        const transitionableEarnings = eligibleEarnings.filter(
            (e) => !cancelledBookingIds.has(String(e.bookingId))
        );

        if (transitionableEarnings.length === 0) {
            return 0;
        }

        const transitionableIds = transitionableEarnings.map((e) => e._id);

        const result = await ConsultantEarning.updateMany(
            { _id: { $in: transitionableIds }, status: EARNING_STATUS.PENDING },
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
