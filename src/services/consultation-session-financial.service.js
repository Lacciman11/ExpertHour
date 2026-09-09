/**
 * Phase 6A — Task 8: Outcome-Driven Financial Orchestration
 *
 * This service is the SOLE bridge between ConsultationSession.outcome and
 * financial consequences (ConsultantEarning, refund/recovery).
 *
 * Design principles:
 *   1. Participants never directly cause financial state changes.
 *   2. Financial state changes occur only from a server-finalized
 *      ConsultationSession.outcome.
 *   3. This service reads the outcome from MongoDB — it never accepts an
 *      outcome as a parameter from external callers.
 *   4. It reuses existing financial primitives:
 *        - consultantEarningService.createEarningFromSession()
 *        - refundService.processRefundWithPaystack()
 *        - consultantEarningService.cancelEarningForBooking()
 *   5. It does NOT call processPayout() or markEarningEligible().
 *   6. External Paystack calls happen OUTSIDE MongoDB transactions.
 *   7. Idempotent: safe to run repeatedly.
 *   8. Concurrency-safe: uses atomic DB guards and existing unique indexes.
 */

import mongoose from "mongoose";

import ConsultationSession from "../models/ConsultationSession.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import ConsultantEarning from "../models/ConsultantEarning.js";
import consultantEarningService from "./consultant-earning.service.js";
import refundService from "./refund.service.js";
import consultationSessionService from "./consultation-session.service.js";
import ApiError from "../utils/ApiError.js";
import paymentLogger from "../utils/logger.js";
import {
    SESSION_OUTCOME,
    EARNING_STATUS,
    ADJUSTMENT_REASON,
    BOOKING_STATUS,
} from "../utils/constants.js";

// ---------------------------------------------------------------------------
// Outcome → Financial Policy
// ---------------------------------------------------------------------------

/**
 * Determine the financial action for a given session outcome.
 * Returns an object describing what the orchestrator should do.
 */
function determineFinancialAction(sessionOutcome) {
    switch (sessionOutcome) {
        // Customer-attributable: consultant earns, no refund
        case SESSION_OUTCOME.COMPLETED:
        case SESSION_OUTCOME.CUSTOMER_NO_SHOW:
        case SESSION_OUTCOME.CUSTOMER_INSUFFICIENT:
            return {
                createEarning: true,
                refund: false,
                earningStatus: EARNING_STATUS.PENDING,
                holdReason: null,
            };

        // Consultant-attributable: consultant earns 0, customer gets 100% refund
        case SESSION_OUTCOME.CONSULTANT_NO_SHOW:
        case SESSION_OUTCOME.CONSULTANT_INSUFFICIENT:
        case SESSION_OUTCOME.CONSULTANT_CANCELLED:
            return {
                createEarning: true,
                refund: true,
                earningStatus: EARNING_STATUS.CANCELLED,
                holdReason: null,
            };

        // Neither met: hold for manual review
        case SESSION_OUTCOME.NEITHER_MET:
            return {
                createEarning: true,
                refund: false,
                earningStatus: EARNING_STATUS.HELD,
                holdReason: "NEITHER_MET_INVESTIGATION",
            };

        default:
            return null;
    }
}

// ---------------------------------------------------------------------------
// Service Class
// ---------------------------------------------------------------------------

class ConsultationSessionFinancialService {

    // -----------------------------------------------------------------------
    // Session Materialization
    // -----------------------------------------------------------------------

    /**
     * Ensure a ConsultationSession exists for the given booking.
     * If the session already exists, return it unchanged.
     * If not, materialize it with deterministic timing from the booking.
     *
     * This addresses the lazy-session-creation risk: a booking can reach
     * its outcome deadline without ever having a ConsultationSession because
     * sessions were previously created only on first attendance activity.
     *
     * @param {string} bookingId - The booking ID
     * @returns {Promise<object|null>} The ConsultationSession document or null
     */
    async ensureSessionExists(bookingId) {
        let session = await ConsultationSession.findOne({ bookingId });
        if (session) {
            return session;
        }

        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return null;
        }

        // Use the existing session creation primitive with E11000-safe pattern.
        try {
            session = await consultationSessionService.createOrUpdateSession(
                bookingId,
                booking.clientId,
                {}
            );
        } catch (error) {
            // If another process created it concurrently, re-read.
            if (error && error.code === 11000) {
                session = await ConsultationSession.findOne({ bookingId });
            } else {
                throw error;
            }
        }

        return session || null;
    }

    // -----------------------------------------------------------------------
    // Precondition Validation
    // -----------------------------------------------------------------------

    /**
     * Validate that all financial prerequisites are satisfied.
     * Does NOT mutate any state.
     *
     * @param {object} session - ConsultationSession document
     * @param {object} booking - Booking document
     * @param {object} payment - Payment document
     * @returns {object} { valid: boolean, reason?: string }
     */
    validateFinancialPrerequisites(session, booking, payment) {
        // Session must have terminal outcome
        if (!session || !session.outcome) {
            return { valid: false, reason: "Session does not have a terminal outcome" };
        }

        // Booking must exist
        if (!booking) {
            return { valid: false, reason: "Booking not found" };
        }

        // Payment must exist
        if (!payment) {
            return { valid: false, reason: "Payment not found" };
        }

        // Payment must be successful
        if (payment.status !== "success") {
            return { valid: false, reason: "Payment status is not 'success'" };
        }

        // Currency must be NGN
        if (payment.currency !== "NGN") {
            return { valid: false, reason: "Unsupported currency: " + payment.currency };
        }

        // Amount must be positive integer (kobo)
        if (!Number.isInteger(payment.amount) || payment.amount <= 0) {
            return { valid: false, reason: "Payment amount must be a positive integer (kobo)" };
        }

        // Booking must be in a financially eligible state
        // (confirmed or completed — not cancelled, not pending)
        if (booking.status === BOOKING_STATUS.CANCELLED) {
            return { valid: false, reason: "Booking is cancelled" };
        }

        if (booking.status === BOOKING_STATUS.PENDING) {
            return { valid: false, reason: "Booking is still pending" };
        }

        return { valid: true };
    }

    // -----------------------------------------------------------------------
    // Core Financial Processing
    // -----------------------------------------------------------------------

    /**
     * Process the financial consequences of a terminal session outcome.
     *
     * This is the sole entry point for outcome-driven financial mutations.
     * It:
     *   1. Loads the ConsultationSession by ID.
     *   2. Requires a terminal outcome.
     *   3. Loads the authoritative Booking and Payment.
     *   4. Validates financial prerequisites.
     *   5. Determines the financial action from the outcome mapping.
     *   6. Creates the ConsultantEarning (idempotent via unique bookingId).
     *   7. Issues refund for consultant-attributable outcomes (if needed).
     *   8. Is safe to run repeatedly.
     *   9. Is safe under concurrent execution.
     *
     * @param {string} sessionId - The ConsultationSession ID
     * @returns {Promise<object>} Processing result
     */
    async processSessionOutcome(sessionId) {
        // -------------------------------------------------------------------
        // 1. Load the ConsultationSession
        // -------------------------------------------------------------------
        const session = await ConsultationSession.findById(sessionId);
        if (!session) {
            throw new ApiError(404, "Consultation session not found");
        }

        // -------------------------------------------------------------------
        // 2. Require a terminal outcome
        // -------------------------------------------------------------------
        const sessionOutcome = session.outcome;
        if (!sessionOutcome) {
            throw new ApiError(400, "Session does not have a terminal outcome");
        }

        // -------------------------------------------------------------------
        // 3. Load the authoritative Booking and Payment
        // -------------------------------------------------------------------
        const booking = await Booking.findById(session.bookingId);
        const payment = await Payment.findOne({
            bookingId: session.bookingId,
            status: "success",
        });

        // -------------------------------------------------------------------
        // 4. Validate financial prerequisites
        // -------------------------------------------------------------------
        const validation = this.validateFinancialPrerequisites(session, booking, payment);
        if (!validation.valid) {
            // Record as a recoverable processing condition — do not mark
            // permanently failed. A later retry may succeed when the payment
            // becomes available or the booking state changes.
            paymentLogger.warn("financial_prerequisites_not_met", {
                event: "financial_prerequisites_not_met",
                sessionId: session._id.toString(),
                bookingId: session.bookingId ? session.bookingId.toString() : null,
                reason: validation.reason,
            });
            throw new ApiError(400, validation.reason);
        }

        // -------------------------------------------------------------------
        // 5. Determine the financial action
        // -------------------------------------------------------------------
        const action = determineFinancialAction(sessionOutcome);
        if (!action) {
            throw new ApiError(400, "Unknown session outcome: " + sessionOutcome);
        }

        // -------------------------------------------------------------------
        // 6. Create the ConsultantEarning (idempotent)
        // -------------------------------------------------------------------
        // Use the existing atomic/idempotent implementation.
        // The unique bookingId index prevents duplicates.
        let earningResult;
        try {
            earningResult = await consultantEarningService.createEarningFromSession(
                booking._id,
                sessionOutcome
            );
        } catch (error) {
            // If the earning already exists (E11000), that's fine — idempotent.
            if (error.code === 11000) {
                const existing = await ConsultantEarning.findOne({ bookingId: booking._id });
                if (existing) {
                    earningResult = { earning: existing, created: false };
                } else {
                    throw error;
                }
            } else {
                throw error;
            }
        }

        const earning = earningResult.earning;

        // -------------------------------------------------------------------
        // 7. Issue refund for consultant-attributable outcomes
        // -------------------------------------------------------------------
        let refundResult = null;
        if (action.refund && payment) {
            // Refund amount = original customer payment amount (authoritative
            // payment snapshot in kobo). Do NOT calculate from hourlyRate.
            const refundAmount = payment.amount;

            // Generate a deterministic refund reference for idempotency.
            // Format: FIN-{bookingId}-{outcome}
            // This ensures the same booking+outcome always produces the same
            // reference, preventing duplicate refunds on retry.
            const refundReference = "FIN-" + booking._id.toString() + "-" + sessionOutcome;

            // Use the existing refund service which handles:
            // - Paystack interaction
            // - idempotency (via refundReference)
            // - native Paystack refund ID
            // - refund persistence
            // - reconciliation
            // - retry behavior
            //
            // IMPORTANT: processRefundWithPaystack() makes the Paystack HTTP
            // call OUTSIDE the MongoDB transaction, then updates local state
            // in a transaction. This is the correct pattern.
            try {
                refundResult = await refundService.processRefundWithPaystack({
                    paymentId: payment._id.toString(),
                    bookingId: booking._id.toString(),
                    refundReference,
                    refundAmount,
                    reason: ADJUSTMENT_REASON.FULL_REFUND,
                    adminId: null, // System-initiated, no admin
                });
            } catch (error) {
                // If the refund was already processed (idempotent), the
                // service returns success. If it's a genuine error, log it
                // but don't fail the entire financial processing — the
                // earning is already created correctly.
                paymentLogger.error("financial_refund_failed", {
                    event: "financial_refund_failed",
                    sessionId: session._id.toString(),
                    bookingId: booking._id ? booking._id.toString() : null,
                    refundReference,
                    error: error.message,
                });

                // Re-throw only for precondition errors that are NOT related
                // to idempotency. "Refund amount exceeds remaining" (400) is
                // expected when the refund was already processed on a previous
                // call (the payment.refundAmount was already saved before
                // the idempotency check in the transaction).
                if (error instanceof ApiError) {
                    // Idempotency-related errors: refund already processed or amount exceeded
                    if (error.statusCode === 400 &&
                        error.message.includes("exceeds remaining")) {
                        // Refund was already processed on a previous call.
                        // Return success with idempotent: true.
                        refundResult = {
                            success: true,
                            idempotent: true,
                            refundReference,
                        };
                    } else if (error.statusCode < 500) {
                        throw error;
                    }
                }

                // For 5xx errors or other errors, return partial success —
                // the earning was created and the refund can be retried.
                if (!refundResult) {
                    refundResult = {
                        success: false,
                        retryable: true,
                        error: error.message,
                    };
                }
            }
        }

        // -------------------------------------------------------------------
        // 8. Return result
        // -------------------------------------------------------------------
        return {
            sessionId: session._id,
            bookingId: booking._id,
            outcome: sessionOutcome,
            earning: {
                id: earning._id,
                status: earning.status,
                consultantEntitlement: earning.consultantEntitlement,
                created: earningResult.created,
            },
            refund: refundResult ? {
                success: refundResult.success,
                idempotent: refundResult.idempotent,
                retryable: refundResult.retryable,
                refundReference: refundResult.refund ? refundResult.refund.refundReference : null,
            } : null,
        };
    }

    // -----------------------------------------------------------------------
    // Worker Discovery
    // -----------------------------------------------------------------------

    /**
     * Find ConsultationSessions that have a terminal outcome but have not
     * yet been processed financially.
     *
     * A session is financially unprocessed when:
     *   - outcome is set (terminal)
     *   - no ConsultantEarning exists for the booking
     *
     * We do NOT add a redundant financialProcessed flag. The existence of
     * the ConsultantEarning is sufficient evidence that processing occurred.
     *
     * @param {number} [limit=50] - Maximum sessions to return
     * @returns {Promise<Array>} Array of { session, booking, payment }
     */
    async findUnprocessedSessions(limit = 50) {
        // Find sessions with terminal outcomes.
        const sessions = await ConsultationSession.find({
            outcome: { $ne: null },
        })
            .limit(limit * 2) // Over-fetch to account for joins
            .lean();

        if (sessions.length === 0) {
            return [];
        }

        // Load bookings and payments in bulk.
        const bookingIds = [...new Set(sessions.map((s) => String(s.bookingId)))];
        const bookings = await Booking.find({
            _id: { $in: bookingIds.map((id) => new mongoose.Types.ObjectId(id)) },
        }).lean();
        const bookingById = new Map(bookings.map((b) => [String(b._id), b]));

        // Find bookings that already have earnings (processed).
        const earnings = await ConsultantEarning.find({
            bookingId: { $in: bookingIds.map((id) => new mongoose.Types.ObjectId(id)) },
        }).lean();
        const processedBookingIds = new Set(earnings.map((e) => String(e.bookingId)));

        // Find payments for all bookings.
        const payments = await Payment.find({
            bookingId: { $in: bookingIds.map((id) => new mongoose.Types.ObjectId(id)) },
        }).lean();
        const paymentByBookingId = new Map(payments.map((p) => [String(p.bookingId), p]));

        // Filter to only unprocessed sessions with valid bookings and payments.
        const result = [];
        for (const session of sessions) {
            const bookingId = String(session.bookingId);
            if (processedBookingIds.has(bookingId)) {
                continue; // Already processed
            }

            const booking = bookingById.get(bookingId);
            if (!booking) {
                continue; // No booking — skip
            }

            const payment = paymentByBookingId.get(bookingId);
            if (!payment) {
                // No payment yet — this is a recoverable condition.
                // The booking may not have been paid yet. Skip and retry later.
                continue;
            }

            result.push({ session, booking, payment });
            if (result.length >= limit) {
                break;
            }
        }

        return result;
    }
}

// ---------------------------------------------------------------------------
// Export Singleton
// ---------------------------------------------------------------------------

export default new ConsultationSessionFinancialService();
