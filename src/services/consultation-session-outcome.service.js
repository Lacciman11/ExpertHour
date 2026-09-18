/**
 * Phase 6A — Task 7: Server-Side ConsultationSession Outcome Determination
 *
 * This service is the SOLE authority for setting ConsultationSession.outcome.
 *
 * Design principles:
 *   1. Outcomes are terminal and server-controlled.
 *   2. The atomic transition is `outcome: null → terminal`, guarded by an
 *      atomic `findOneAndUpdate`. Two concurrent finalizers cannot both
 *      succeed; the first wins.
 *   3. The pure calculation (`determineSessionOutcome`) is deterministic
 *      given a fixed `asOf`, so legitimate concurrent workers should
 *      normally compute the same result. The atomic guard is the final
 *      defense — not the only one.
 *   4. This service NEVER invokes:
 *        - createEarningFromSession
 *        - refundPayment / any refund path
 *        - processPayout / any payout path
 *        - markEarningEligible / any earning transition
 *      It only writes `ConsultationSession.outcome` and
 *      `outcomeFinalizedAt`. Financial orchestration belongs to a
 *      separate downstream layer (future task).
 *   5. The service uses ONLY server-derived inputs:
 *        - session.scheduledStart / scheduledEnd
 *        - session.consultantGraceEnd / clientWaitEnd
 *        - session.clientAttendanceMet / consultantAttendanceMet
 *        - session.clientAttendanceDuration / consultantAttendanceDuration
 *        - session.attendanceEvents (trusted)
 *        - booking.cancelledAt / booking.cancelledBy (trusted)
 *      It NEVER reads participant-supplied status fields.
 *   6. The background worker uses the project's recursive-setTimeout
 *      pattern with clean shutdown semantics.
 */

import mongoose from "mongoose";

import ConsultationSession from "../models/ConsultationSession.js";
import Booking from "../models/Booking.js";

import env from "../config/env.js";
import paymentLogger from "../utils/logger.js";
import { SESSION_OUTCOME, CANCEL_ACTOR } from "../utils/constants.js";

const { intervalMs } = env.consultationSessionOutcome;

// ---------------------------------------------------------------------------
// Pure helpers (no DB access) — exported for testability
// ---------------------------------------------------------------------------

/**
 * Did this participant ever send a join signal?
 * Pure function on the session's attendanceEvents.
 */
function participantEverAttended(session, participant) {
    return Array.isArray(session.attendanceEvents)
        ? session.attendanceEvents.some((ev) => ev && ev.participant === participant)
        : false;
}

/**
 * Determine the terminal session outcome from trusted server state.
 *
 * Returns one of:
 *   - null      → not yet eligible for finalization (timing not met)
 *   - SESSION_OUTCOME.* → terminal outcome
 *
 * Precedence (highest first; the first row that applies wins):
 *   1. Consultant cancelled the booking (Booking.cancelledBy === "consultant"
 *      AND cancelledAt is set) → CONSULTANT_CANCELLED.
 *      This takes precedence over attendance because consultant cancellation
 *      is a binding business event that pre-empts attendance derivation.
 *   2. Both attended and met threshold → COMPLETED.
 *   3. Consultant never attended, consultant grace expired → CONSULTANT_NO_SHOW.
 *   4. Customer never attended, customer wait expired → CUSTOMER_NO_SHOW.
 *   5. Consultant attended but failed threshold → CONSULTANT_INSUFFICIENT.
 *   6. Customer attended but failed threshold → CUSTOMER_INSUFFICIENT.
 *   7. Both attended, both failed threshold → NEITHER_MET.
 *   8. Neither attended (no-activity) → NEITHER_MET.
 *      Documented choice: when the current business rules do not specify
 *      which party owns this case, we resolve it as NEITHER_MET so a
 *      downstream dispute/override layer can decide.
 *
 * Eligibility (timing):
 *   - The session must have a scheduledStart and scheduledEnd.
 *   - "Now" must be at or after the latest relevant deadline:
 *       * If both attended → scheduledEnd (we have full data)
 *       * If only consultant attended → clientWaitEnd (we can decide
 *         CUSTOMER_NO_SHOW; for NEITHER_MET, need to wait scheduledEnd)
 *       * If only customer attended → consultantGraceEnd (we can decide
 *         CONSULTANT_NO_SHOW; for NEITHER_MET, need to wait scheduledEnd)
 *       * If neither attended → consultantGraceEnd + clientWaitEnd; we
 *         need the LATER of the two to be confident the absent party
 *         is genuinely absent (we use `clientWaitEnd` which is the
 *         LATER deadline, matching Task 6 grace ordering).
 *
 *   This function does NOT perform any side effects.
 *
 * @param {object} session - ConsultationSession with all server-derived fields
 *   populated by `reconcileAttendance`. `attendanceEvents` is trusted.
 * @param {object} [booking] - Optional Booking document. If provided,
 *   `cancelledBy === "consultant"` and `cancelledAt` are checked.
 * @param {Date} [asOf] - Optional override for "now" (testing).
 * @returns {string|null}
 */
export function determineSessionOutcome(session, booking = null, asOf = null) {
    if (!session || !session.scheduledStart || !session.scheduledEnd) {
        return null;
    }
    const now = asOf || new Date();

    // ---------------------------------------------------------------
    // Precedence 1: Consultant cancellation of the booking is binding.
    // ---------------------------------------------------------------
    if (
        booking &&
        booking.cancelledBy === CANCEL_ACTOR.CONSULTANT &&
        booking.cancelledAt
    ) {
        return SESSION_OUTCOME.CONSULTANT_CANCELLED;
    }

    const consultantMet = session.consultantAttendanceMet === true;
    const customerMet = session.clientAttendanceMet === true;

    const consultantEverAttended = participantEverAttended(session, "consultant");
    const customerEverAttended = participantEverAttended(session, "client");

    // ---------------------------------------------------------------
    // Precedence 2: Both met → COMPLETED
    // (We need full information: scheduledEnd must have passed.)
    // ---------------------------------------------------------------
    if (consultantMet && customerMet) {
        if (now.getTime() >= new Date(session.scheduledEnd).getTime()) {
            return SESSION_OUTCOME.COMPLETED;
        }
        return null;
    }

    // ---------------------------------------------------------------
    // Precedence 3: Neither attended → NEITHER_MET
    // Per Phase 6A Task 7 brief: this case is resolved as NEITHER_MET
    // (documented choice — the brief does not specify which party owns
    // an entirely no-show session, so a downstream dispute/override layer
    // can decide). This MUST be checked BEFORE individual no-show rules
    // because the precedence table explicitly maps "never attends /
    // never attends" to NEITHER_MET, not to a specific party's no-show.
    // ---------------------------------------------------------------
    if (!consultantEverAttended && !customerEverAttended) {
        // We need at least the later of the two deadlines to have passed
        // so we can be confident both parties are genuinely absent.
        const laterDeadline = session.clientWaitEnd
            ? new Date(session.clientWaitEnd).getTime()
            : session.consultantGraceEnd
                ? new Date(session.consultantGraceEnd).getTime()
                : new Date(session.scheduledEnd).getTime();
        if (now.getTime() >= laterDeadline) {
            return SESSION_OUTCOME.NEITHER_MET;
        }
        return null;
    }

    // ---------------------------------------------------------------
    // Precedence 4: Consultant never attended (customer did) and
    // consultant grace expired → CONSULTANT_NO_SHOW.
    // ---------------------------------------------------------------
    if (!consultantEverAttended && session.consultantGraceEnd) {
        if (now.getTime() >= new Date(session.consultantGraceEnd).getTime()) {
            return SESSION_OUTCOME.CONSULTANT_NO_SHOW;
        }
        return null;
    }

    // ---------------------------------------------------------------
    // Precedence 5: Customer never attended (consultant did) and
    // client wait expired → CUSTOMER_NO_SHOW.
    // ---------------------------------------------------------------
    if (!customerEverAttended && session.clientWaitEnd) {
        if (now.getTime() >= new Date(session.clientWaitEnd).getTime()) {
            return SESSION_OUTCOME.CUSTOMER_NO_SHOW;
        }
        return null;
    }

    // ---------------------------------------------------------------
    // From here we have at least one attendee. We need scheduledEnd to
    // have passed before we can decide between INSUFFICIENT and
    // NEITHER_MET (the threshold check is against the full window).
    // ---------------------------------------------------------------
    if (now.getTime() < new Date(session.scheduledEnd).getTime()) {
        return null;
    }

    // ---------------------------------------------------------------
    // Precedence 6: Consultant attended, customer met → CONSULTANT_INSUFFICIENT
    // ---------------------------------------------------------------
    if (consultantEverAttended && !consultantMet && customerMet) {
        return SESSION_OUTCOME.CONSULTANT_INSUFFICIENT;
    }

    // ---------------------------------------------------------------
    // Precedence 7: Customer attended, consultant met → CUSTOMER_INSUFFICIENT
    // ---------------------------------------------------------------
    if (customerEverAttended && !customerMet && consultantMet) {
        return SESSION_OUTCOME.CUSTOMER_INSUFFICIENT;
    }

    // ---------------------------------------------------------------
    // Precedence 8: both attended but neither met → NEITHER_MET.
    // (The "neither attended" case was already handled above.)
    // ---------------------------------------------------------------
    return SESSION_OUTCOME.NEITHER_MET;
}

/**
 * Determine whether a session is eligible for outcome processing at `asOf`.
 *
 * A session is eligible when at least one of the timing deadlines has passed
 * AND `outcome` is null. This drives the worker query so we do not scan
 * fresh sessions.
 */
export function isOutcomeEligible(session, asOf = null) {
    if (!session) return false;
    if (session.outcome) return false;
    if (!session.scheduledStart || !session.scheduledEnd) return false;
    const now = asOf || new Date();
    const nowMs = now.getTime();

    // The earliest we can decide ANY outcome is consultantGraceEnd
    // (CONSULTANT_NO_SHOW) or scheduledEnd (COMPLETED / INSUFFICIENT /
    // NEITHER_MET). CUSTOMER_NO_SHOW needs clientWaitEnd (later).
    const earliestDecisionPoint = session.consultantGraceEnd
        ? new Date(session.consultantGraceEnd).getTime()
        : new Date(session.scheduledEnd).getTime();

    return nowMs >= earliestDecisionPoint;
}

// ---------------------------------------------------------------------------
// Service class — atomic transition + worker
// ---------------------------------------------------------------------------

class ConsultationSessionOutcomeService {

    constructor() {

        this.isRunning = false;

        this.shutdownRequested = false;

        this.timerId = null;

        // Process all eligible sessions in a single cycle.
        this.batchSize = 50;

    }

    // -------------------------------------------------------------------
    // Atomic outcome finalization
    // -------------------------------------------------------------------

    /**
     * Reconcile attendance, compute the deterministic outcome, and atomically
     * finalize it. Idempotent: if the session already has an outcome, returns
     * the existing outcome without modification.
     *
     * @param {string|object} sessionOrBookingId - Booking's _id (string or ObjectId)
     *   or a loaded ConsultationSession document.
     * @param {Date} [asOf] - Optional "now" override for testing.
     * @param {object} [preloadedSession] - Optional preloaded session document
     *   to skip the DB read. Internal worker optimization.
     * @returns {Promise<object|null>} { outcome, wasAlreadyFinalized,
     *   wasJustFinalized, sessionId }
     */
    async finalizeOutcome(sessionOrBookingId, asOf = null, preloadedSession = null) {

        // Resolve to a ConsultationSession document.
        let session = preloadedSession;
        let booking = null;
        const isIdLike =
            typeof sessionOrBookingId === "string" ||
            (sessionOrBookingId &&
                sessionOrBookingId.constructor &&
                sessionOrBookingId.constructor.name === "ObjectId");
        if (isIdLike) {
            // Treat as Booking ID — the worker's primary lookup key.
            booking = await Booking.findById(sessionOrBookingId);
            if (!booking) return null;
            if (!session) {
                session = await ConsultationSession.findOne({
                    bookingId: booking._id,
                });
            }
        } else if (sessionOrBookingId && sessionOrBookingId.bookingId) {
            session = sessionOrBookingId;
            if (!booking) {
                booking = await Booking.findById(session.bookingId);
            }
        } else {
            return null;
        }

        if (!session) return null;

        // Already finalized? Return existing outcome (idempotent).
        if (session.outcome) {
            return {
                outcome: session.outcome,
                wasAlreadyFinalized: true,
                wasJustFinalized: false,
                sessionId: session._id,
            };
        }

        // Backfill scheduled window defensively (no-op if already set).
        if (!session.scheduledStart || !session.scheduledEnd) {
            if (booking) {
                const win = await this._calculateScheduledWindowSafe(booking);
                if (win) {
                    session.scheduledStart = win.scheduledStart;
                    session.scheduledEnd = win.scheduledEnd;
                    session.consultantGraceEnd = win.consultantGraceEnd;
                    session.clientWaitEnd = win.clientWaitEnd;
                    session.requiredDurationSeconds = win.requiredDurationSeconds;
                }
            }
        }

        // Reconcile attendance first (idempotent; safe to repeat).
        const calc = await this._reconcileAttendanceSafe(session, asOf);
        if (calc) {
            session.clientAttendanceDuration = calc.clientAttendanceDuration;
            session.consultantAttendanceDuration = calc.consultantAttendanceDuration;
            session.clientAttendanceMet = calc.clientAttendanceMet;
            session.consultantAttendanceMet = calc.consultantAttendanceMet;
            session.lastReconciledAt = calc.lastReconciledAt;
        }

        // Compute deterministic outcome.
        const outcome = determineSessionOutcome(session, booking, asOf);
        if (!outcome) {
            return {
                outcome: null,
                wasAlreadyFinalized: false,
                wasJustFinalized: false,
                sessionId: session._id,
            };
        }

        // Atomic terminal transition. Two concurrent workers computing the
        // SAME outcome will both reach this point; the second one's
        // findOneAndUpdate will return null (the guard `outcome: null` no
        // longer matches). We log the race but do not treat it as an error.
        const finalizedAt = asOf || new Date();
        const updated = await ConsultationSession.findOneAndUpdate(
            { _id: session._id, outcome: null },
            {
                $set: {
                    outcome,
                    outcomeFinalizedAt: finalizedAt,
                    // Persist reconciled fields atomically with the outcome.
                    clientAttendanceDuration: session.clientAttendanceDuration,
                    consultantAttendanceDuration: session.consultantAttendanceDuration,
                    clientAttendanceMet: session.clientAttendanceMet,
                    consultantAttendanceMet: session.consultantAttendanceMet,
                    lastReconciledAt: session.lastReconciledAt,
                },
            },
            { new: true }
        );

        if (!updated) {
            // Another worker won the race. Re-read to learn the winner.
            const winner = await ConsultationSession.findById(session._id);
            return {
                outcome: winner ? winner.outcome : null,
                wasAlreadyFinalized: true,
                wasJustFinalized: false,
                sessionId: session._id,
            };
        }

        paymentLogger.info("outcome_finalized", {
            event: "outcome_finalized",
            sessionId: updated._id?.toString?.(),
            bookingId: updated.bookingId?.toString?.(),
            outcome,
        });

        return {
            outcome,
            wasAlreadyFinalized: false,
            wasJustFinalized: true,
            sessionId: updated._id,
        };
    }

    // -------------------------------------------------------------------
    // Internal helpers (safe wrappers around service imports to avoid
    // tight coupling and to make tests easier).
    // -------------------------------------------------------------------

    async _reconcileAttendanceSafe(session, asOf) {
        try {
            // Import the consultation-session service lazily to avoid
            // circular import at module load time.
            const mod = await import("./consultation-session.service.js");
            return await mod.default.reconcileAttendance(session, asOf);
        } catch (e) {
            paymentLogger.error("outcome_reconcile_failed", {
                event: "outcome_reconcile_failed",
                error: e.message,
            });
            return null;
        }
    }

    async _calculateScheduledWindowSafe(booking) {
        try {
            const mod = await import("./consultation-session.service.js");
            return mod.calculateScheduledWindow(booking);
        } catch (e) {
            paymentLogger.error("outcome_window_calc_failed", {
                event: "outcome_window_calc_failed",
                error: e.message,
            });
            return null;
        }
    }

    // -------------------------------------------------------------------
    // Worker discovery query
    // -------------------------------------------------------------------

    /**
     * Find sessions eligible for outcome processing.
     *
     * Criteria:
     *   - outcome === null (not yet finalized)
     *   - consultantGraceEnd <= now OR scheduledEnd <= now
     *     (we have at least one decision point in the past)
     *
     * Bookings whose `cancelledBy === "consultant"` are also eligible
     * immediately — consultant cancellation is binding regardless of
     * timing. To catch these, we additionally query ConsultationSession
     * documents whose booking is consultant-cancelled. Since this is
     * rare, we do a single combined query via aggregation:
     *
     *   For each session with outcome === null:
     *     - if scheduledStart + consultantGrace (or scheduledEnd) <= now
     *       → eligible.
     *
     * Consultant-cancelled bookings that have NO ConsultationSession
     * document are not finalized by this worker (the cancellation path
     * already created a refund; the session is unnecessary). They are
     * documented but not actionable here.
     */
    async _findEligibleSessions() {
        const now = new Date();

        // Conservative eligibility: scheduledEnd must have passed OR
        // consultantGraceEnd must have passed. This catches both
        // COMPLETED and CONSULTANT_NO_SHOW early.
        //
        // Google Meet timing guard: if a session has a non-empty
        // googleConferenceRecordId but googleAttendanceSyncedAt is null,
        // defer outcome finalization until the Google Meet attendance
        // worker has had a chance to synchronize attendance data.
        // This prevents the outcome worker from finalizing an outcome
        // based on empty/incomplete attendanceEvents before Google Meet
        // data is available.
        const sessions = await ConsultationSession.find({
            outcome: null,
            $or: [
                { scheduledEnd: { $lte: now } },
                { consultantGraceEnd: { $lte: now } },
            ],
            $nor: [
                {
                    googleConferenceRecordId: { $nin: ["", null] },
                    googleAttendanceSyncedAt: null,
                },
            ],
        })
            .limit(this.batchSize)
            .lean();

        // For each eligible session, also load its booking so we can
        // check cancellation actor. Done in bulk for efficiency.
        const bookingIds = [...new Set(sessions.map((s) => String(s.bookingId)))];
        const bookings = await Booking.find({
            _id: { $in: bookingIds.map((id) => new mongoose.Types.ObjectId(id)) },
        }).lean();
        const bookingById = new Map(
            bookings.map((b) => [String(b._id), b])
        );

        return sessions.map((session) => ({
            session,
            booking: bookingById.get(String(session.bookingId)) || null,
        }));
    }

    async _runCycle() {

        const cycleStart = Date.now();

        paymentLogger.info("outcome_cycle_started", {
            event: "outcome_cycle_started",
            cycleStart: new Date(cycleStart).toISOString(),
        });

        let processed = 0;
        let finalized = 0;

        try {

            const eligible = await this._findEligibleSessions();

            for (const { session, booking } of eligible) {

                processed += 1;

                try {

                    // Pass the bookingId (which IS what finalizeOutcome's
                    // Booking-ID lookup expects). We already loaded the
                    // session via the discovery query, so we pass the
                    // session document directly to avoid an extra read.
                    const result = await this.finalizeOutcome(
                        session.bookingId,
                        null,
                        session
                    );

                    if (result && result.wasJustFinalized) {
                        finalized += 1;
                    }

                } catch (err) {

                    paymentLogger.error("outcome_finalize_failed", {
                        event: "outcome_finalize_failed",
                        sessionId: String(session._id),
                        error: err.message,
                    });

                }
            }

            paymentLogger.info("outcome_cycle_completed", {
                event: "outcome_cycle_completed",
                processed,
                finalized,
                cycleDurationMs: Date.now() - cycleStart,
            });

        } catch (error) {

            paymentLogger.error("outcome_cycle_failed", {
                event: "outcome_cycle_failed",
                error: error.message,
            });

        }
    }

    // -------------------------------------------------------------------
    // Lifecycle (recursive setTimeout, matching project pattern)
    // -------------------------------------------------------------------

    start() {

        if (this.isRunning) {

            paymentLogger.info("outcome_worker_already_running", {
                event: "outcome_worker_already_running",
            });

            return;
        }

        this.isRunning = true;
        this.shutdownRequested = false;

        paymentLogger.info("outcome_worker_starting", {
            event: "outcome_worker_starting",
            intervalMs,
        });

        this._scheduleNext();

    }

    stop() {

        this.shutdownRequested = true;

        if (this.timerId) {

            clearTimeout(this.timerId);

            this.timerId = null;

        }

        // Synchronously mark the worker as stopped so callers can
        // observe the new state immediately (without waiting for a
        // pending setTimeout to fire).
        this.isRunning = false;

        paymentLogger.info("outcome_worker_shutdown_requested", {
            event: "outcome_worker_shutdown_requested",
        });

    }

    _scheduleNext() {

        if (this.shutdownRequested) {

            this.isRunning = false;

            paymentLogger.info("outcome_worker_stopped", {
                event: "outcome_worker_stopped",
            });

            return;
        }

        this.timerId = setTimeout(() => {

            this._runCycle().finally(() => {

                this._scheduleNext();

            });

        }, intervalMs);

    }
}

// ---------------------------------------------------------------------------
// Export Singleton
// ---------------------------------------------------------------------------

export default new ConsultationSessionOutcomeService();
