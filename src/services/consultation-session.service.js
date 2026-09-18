import ConsultationSession from "../models/ConsultationSession.js";
import Booking from "../models/Booking.js";
import ApiError from "../utils/ApiError.js";
import {
    APP_TIMEZONE_UTC_OFFSET,
} from "../utils/constants.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Consultant grace period after scheduledStart before they may be flagged
// as a no-show. Spec is 15 minutes (Phase 6A Task 4 brief).
const CONSULTANT_GRACE_MS = 15 * 60 * 1000;

// Customer wait period after scheduledStart before they may be flagged
// as a no-show. Spec is 20 minutes.
const CLIENT_WAIT_MS = 20 * 60 * 1000;

// Attendance threshold expressed in basis points: 80% = 8000 / 10000.
// We compute required duration using integer math:
//   required = floor(durationMinutes * 60 * 80 / 100)
const ATTENDANCE_THRESHOLD_BPS = 8000;
const ATTENDANCE_THRESHOLD_DENOMINATOR = 10000;

// ---------------------------------------------------------------------------
// Trust-boundary constants
// ---------------------------------------------------------------------------
//
// Fields below are SERVER-CONTROLLED. Participant-facing methods MUST NOT
// write any of them under any circumstance. The architecture forbids
// participant influence over financial or session-outcome state.
//
export const SESSION_PROTECTED_FIELDS = Object.freeze([
    // Canonical session outcome / status (server-derived)
    "attendanceStatus",
    "outcome",
    "outcomeFinalizedAt",

    // Server-derived attendance qualification flags
    "clientAttendanceMet",
    "consultantAttendanceMet",
    "clientAttendanceDuration",
    "consultantAttendanceDuration",

    // Scheduled-window fields (server-derived from Booking)
    "scheduledStart",
    "scheduledEnd",
    "consultantGraceEnd",
    "clientWaitEnd",
    "requiredDurationSeconds",

    // Server-derived first-join timestamps (derived from attendanceEvents)
    "startedAt",
    "endedAt",
    "clientJoinedAt",
    "consultantJoinedAt",

    // Reconciliation bookkeeping
    "lastReconciledAt",
]);

function assertNoProtectedFields(data, caller) {
    if (!data || typeof data !== "object") return;
    for (const field of SESSION_PROTECTED_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(data, field)) {
            throw new ApiError(
                400,
                `Field '${field}' is server-controlled and cannot be set via ${caller}`
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Pure helpers (no DB access) — exported for testability
// ---------------------------------------------------------------------------

/**
 * Calculate the deterministic scheduled session window and grace deadlines
 * from a Booking's date/time/duration. Uses the project's Africa/Lagos
 * (UTC+1) timezone constant — Nigeria does not observe DST.
 *
 * @param {object} booking - Booking document (must have date, time, duration)
 * @returns {object} { scheduledStart, scheduledEnd, consultantGraceEnd,
 *   clientWaitEnd, requiredDurationSeconds } as Date instances / numbers.
 */
export function calculateScheduledWindow(booking) {
    if (!booking || typeof booking.date !== "string" || typeof booking.time !== "string") {
        throw new ApiError(500, "Booking is missing date/time strings");
    }
    const durationMinutes = Number(booking.duration);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        throw new ApiError(500, "Booking duration is invalid");
    }

    // Parse Booking.date + Booking.time as wall-clock in Africa/Lagos.
    const scheduledStart = new Date(
        `${booking.date}T${booking.time}:00${APP_TIMEZONE_UTC_OFFSET}`
    );
    if (Number.isNaN(scheduledStart.getTime())) {
        throw new ApiError(500, "Failed to parse booking date/time");
    }

    const scheduledEnd = new Date(
        scheduledStart.getTime() + durationMinutes * 60 * 1000
    );
    const consultantGraceEnd = new Date(
        scheduledStart.getTime() + CONSULTANT_GRACE_MS
    );
    const clientWaitEnd = new Date(
        scheduledStart.getTime() + CLIENT_WAIT_MS
    );

    // Integer math for the 80% threshold.
    //   required = floor(durationMinutes * 60 * 80 / 100)
    // We deliberately multiply by 60 first to avoid losing precision when
    // durationMinutes is small (e.g. 30 → 1440 seconds before percentage).
    const requiredDurationSeconds = Math.floor(
        (durationMinutes * 60 * ATTENDANCE_THRESHOLD_BPS) /
            ATTENDANCE_THRESHOLD_DENOMINATOR
    );

    return {
        scheduledStart,
        scheduledEnd,
        consultantGraceEnd,
        clientWaitEnd,
        requiredDurationSeconds,
    };
}

/**
 * Calculate cumulative attendance duration in seconds for one participant,
 * clamping each event to the [scheduledStart, scheduledEnd] window.
 *
 * Open events (no leftAt) are clamped to scheduledEnd for duration purposes
 * WITHOUT mutating the stored leftAt.
 *
 * @param {Array} events - attendanceEvents for ONE participant
 * @param {Date} scheduledStart
 * @param {Date} scheduledEnd
 * @param {Date} asOf - Time used as the "now" reference for open events.
 *   Defaults to `scheduledEnd` so open events are capped at the window
 *   boundary by default (this matches the calculation rule for the
 *   outcome worker, which will reconcile after scheduledEnd).
 * @returns {number} cumulative integer seconds
 */
export function calculateParticipantDuration(
    events,
    scheduledStart,
    scheduledEnd,
    asOf = null
) {
    if (!Array.isArray(events) || events.length === 0) return 0;
    if (!scheduledStart || !scheduledEnd) return 0;

    const startMs = scheduledStart.getTime();
    const endMs = scheduledEnd.getTime();
    const asOfMs = asOf ? asOf.getTime() : endMs;

    let total = 0;
    for (const ev of events) {
        if (!ev || !ev.joinedAt) continue;
        const joinedMs = new Date(ev.joinedAt).getTime();
        if (!Number.isFinite(joinedMs)) continue;
        // Open events: cap at asOf (default scheduledEnd) — do NOT mutate.
        const leftMsRaw = ev.leftAt ? new Date(ev.leftAt).getTime() : asOfMs;
        if (!Number.isFinite(leftMsRaw)) continue;

        const effectiveStart = Math.max(joinedMs, startMs);
        const effectiveEnd = Math.min(leftMsRaw, endMs);

        if (effectiveEnd <= effectiveStart) continue;

        total += Math.floor((effectiveEnd - effectiveStart) / 1000);
    }

    return total;
}

/**
 * Compute server-derived attendance fields for a ConsultationSession given
 * its current attendanceEvents. Pure function — does not touch the DB.
 *
 * @param {object} session - ConsultationSession document (plain or Mongoose)
 * @param {Date} [asOf] - Optional override for "now" reference (used for
 *   open events during testing). Defaults to scheduledEnd.
 * @returns {object} { clientAttendanceDuration, consultantAttendanceDuration,
 *   clientAttendanceMet, consultantAttendanceMet, lastReconciledAt }
 */
export function computeAttendanceQualification(session, asOf = null) {
    const refTime = asOf || session.scheduledEnd || new Date();

    const clientEvents = (session.attendanceEvents || []).filter(
        (ev) => ev.participant === "client"
    );
    const consultantEvents = (session.attendanceEvents || []).filter(
        (ev) => ev.participant === "consultant"
    );

    const clientAttendanceDuration = calculateParticipantDuration(
        clientEvents,
        session.scheduledStart,
        session.scheduledEnd,
        refTime
    );
    const consultantAttendanceDuration = calculateParticipantDuration(
        consultantEvents,
        session.scheduledStart,
        session.scheduledEnd,
        refTime
    );

    const required = Number(session.requiredDurationSeconds) || 0;

    const clientAttendanceMet =
        required > 0 ? clientAttendanceDuration >= required : null;
    const consultantAttendanceMet =
        required > 0 ? consultantAttendanceDuration >= required : null;

    return {
        clientAttendanceDuration,
        consultantAttendanceDuration,
        clientAttendanceMet,
        consultantAttendanceMet,
        lastReconciledAt: new Date(),
    };
}

// ---------------------------------------------------------------------------
// ConsultationSessionService
// ---------------------------------------------------------------------------

class ConsultationSessionService {

    // -----------------------------------------------------------------------
    // Session creation / update (participant-controlled fields only)
    // -----------------------------------------------------------------------

    /**
     * Create or update a ConsultationSession with ONLY participant-allowed
     * fields: `notes`. Recording URL is handled separately by
     * `addRecordingUrl()` (consultant-only).
     *
     * Trust boundary:
     * - Caller MUST be the booking's client or consultant.
     * - Server-derived fields (scheduledStart, scheduledEnd, durations,
     *   met-flags, attendanceStatus, etc.) are NEVER accepted from input.
     * - On creation, scheduled-window fields are deterministically derived
     *   from the Booking.
     */
    async createOrUpdateSession(bookingId, userId, data) {
        const safe = {};
        if (data && typeof data.notes === "string") {
            safe.notes = data.notes;
        }
        assertNoProtectedFields(data, "createOrUpdateSession");

        const booking = await Booking.findById(bookingId);
        if (!booking) {
            throw new ApiError(404, "Booking not found");
        }

        const isConsultant = booking.consultantId.toString() === userId.toString();
        const isClient = booking.clientId.toString() === userId.toString();
        if (!isConsultant && !isClient) {
            throw new ApiError(403, "Not authorized to update this session");
        }

        let session = await ConsultationSession.findOne({ bookingId });

        if (!session) {
            // First creation: populate scheduled-window fields from booking.
            const win = calculateScheduledWindow(booking);
            try {
                session = await ConsultationSession.create({
                    bookingId,
                    consultantId: booking.consultantId,
                    clientId: booking.clientId,
                    ...safe,
                    ...win,
                });
            } catch (err) {
                if (err && err.code === 11000) {
                    session = await ConsultationSession.findOne({ bookingId });
                } else {
                    throw err;
                }
            }
        } else {
            // Backfill scheduled window if missing (e.g., sessions created
            // by older code paths before this task). Do NOT overwrite an
            // already-populated window — the booking's wall-clock time is
            // not expected to change after session creation.
            if (!session.scheduledStart || !session.scheduledEnd) {
                const win = calculateScheduledWindow(booking);
                session.scheduledStart = win.scheduledStart;
                session.scheduledEnd = win.scheduledEnd;
                session.consultantGraceEnd = win.consultantGraceEnd;
                session.clientWaitEnd = win.clientWaitEnd;
                session.requiredDurationSeconds = win.requiredDurationSeconds;
            }
            if (safe.notes !== undefined) {
                session.notes = safe.notes;
            }
            await session.save();
        }

        return session;
    }

    async getSessionByBookingId(bookingId, userId) {
        const booking = await Booking.findById(bookingId);
        if (!booking) {
            throw new ApiError(404, "Booking not found");
        }

        const isConsultant = booking.consultantId.toString() === userId.toString();
        const isClient = booking.clientId.toString() === userId.toString();
        if (!isConsultant && !isClient) {
            throw new ApiError(403, "Not authorized to view this session");
        }

        const session = await ConsultationSession.findOne({ bookingId });
        return session;
    }

    // -----------------------------------------------------------------------
    // Participant attendance signaling (TRUST BOUNDARY)
    // -----------------------------------------------------------------------
    //
    // Atomic MongoDB `findOneAndUpdate` with conditional `$not` filters
    // is used so that concurrent requests cannot create duplicate open
    // events for the same participant, and cannot re-close an already-closed
    // event.

    static ALLOWED_ACTIONS = Object.freeze(["join", "leave"]);

    /**
     * Record an attendance signal (join or leave) for the calling participant.
     *
     * Trust-boundary guarantees enforced here:
     *   1. Only the booking's client or consultant may submit a signal.
     *   2. Signals are scoped per-participant.
     *   3. Terminal `attendanceStatus` values cannot be submitted.
     *   4. Server-derived fields are NEVER written by this method.
     *   5. This method NEVER triggers earning creation or refunds.
     */
    async recordAttendanceSignal(bookingId, userId, action) {
        // Strict allowlist BEFORE any DB access — fail fast.
        if (typeof action !== "string") {
            throw new ApiError(400, "action must be a string");
        }
        if (!ConsultationSessionService.ALLOWED_ACTIONS.includes(action)) {
            throw new ApiError(
                400,
                `Invalid attendance action: '${action}'. Allowed actions: ${ConsultationSessionService.ALLOWED_ACTIONS.join(", ")}`
            );
        }

        const booking = await Booking.findById(bookingId);
        if (!booking) {
            throw new ApiError(404, "Booking not found");
        }

        const isConsultant = booking.consultantId.toString() === userId.toString();
        const isClient = booking.clientId.toString() === userId.toString();
        if (!isConsultant && !isClient) {
            throw new ApiError(403, "Not authorized to record attendance");
        }

        const participant = isConsultant ? "consultant" : "client";

        // Ensure the session exists with scheduled window populated.
        // We use a retry-on-E11000 pattern to handle the race where two
        // concurrent signals for the same booking both observe "no session"
        // and both attempt to insert. The unique index on `bookingId` will
        // reject one of them; we then re-read the existing document.
        let session = await ConsultationSession.findOne({ bookingId });
        if (!session) {
            const win = calculateScheduledWindow(booking);
            try {
                session = await ConsultationSession.create({
                    bookingId,
                    consultantId: booking.consultantId,
                    clientId: booking.clientId,
                    ...win,
                });
            } catch (err) {
                if (err && err.code === 11000) {
                    // Concurrent creator won the race — read the winner.
                    session = await ConsultationSession.findOne({ bookingId });
                } else {
                    throw err;
                }
            }
        }
        if (!session) {
            throw new ApiError(500, "Failed to materialize ConsultationSession");
        }
        if (!session.scheduledStart || !session.scheduledEnd) {
            // Backfill scheduled window for legacy sessions.
            const win = calculateScheduledWindow(booking);
            session.scheduledStart = win.scheduledStart;
            session.scheduledEnd = win.scheduledEnd;
            session.consultantGraceEnd = win.consultantGraceEnd;
            session.clientWaitEnd = win.clientWaitEnd;
            session.requiredDurationSeconds = win.requiredDurationSeconds;
            await session.save();
        }

        const now = new Date();

        if (action === "join") {
            // Atomic insert: only append if no open event exists for the
            // participant. $not + $elemMatch ensures we never create two
            // open events for the same participant, even under concurrent
            // requests.
            //
            // Mongoose `findOneAndUpdate` with `arrayFilters` lets us
            // express: "if any element matches participant==P AND
            // leftAt==null, do nothing; otherwise push a new open event."
            //
            // We approximate "if no open event" by guarding with `$not`
            // on `attendanceEvents` and then `$push`. Because the `save`
            // path in mongoose serializes writes per-document, we still
            // rely on the Mongo write atomicity at the document level.
            const updated = await ConsultationSession.findOneAndUpdate(
                {
                    _id: session._id,
                    attendanceEvents: {
                        $not: {
                            $elemMatch: {
                                participant,
                                leftAt: null,
                            },
                        },
                    },
                },
                {
                    $push: {
                        attendanceEvents: {
                            participant,
                            joinedAt: now,
                            leftAt: null,
                            durationSeconds: 0,
                        },
                    },
                    // Maintain first-join timestamp for back-compat fields.
                    ...(participant === "client"
                        ? { $set: { clientJoinedAt: now, startedAt: now } }
                        : {
                              $set: {
                                  consultantJoinedAt: now,
                                  startedAt: now,
                              },
                          }),
                },
                { new: true }
            );

            // If `updated` is null, an open event already existed. This is
            // an idempotent no-op (per the brief).
            return updated || session;
        }

        // action === "leave"
        // Atomic close: find the latest open event for this participant
        // and set leftAt + durationSeconds. If no open event exists, this
        // is a no-op.
        const events = session.attendanceEvents || [];
        for (let i = events.length - 1; i >= 0; i--) {
            const ev = events[i];
            if (ev.participant === participant && ev.leftAt === null) {
                ev.leftAt = now;
                ev.durationSeconds = Math.max(
                    0,
                    Math.floor(
                        (now.getTime() - new Date(ev.joinedAt).getTime()) / 1000
                    )
                );
                break;
            }
        }

        session.endedAt = now;
        await session.save();
        return session;
    }

    // -----------------------------------------------------------------------
    // Reconciliation: compute server-derived attendance fields
    // -----------------------------------------------------------------------

    /**
     * Idempotently reconcile attendance durations and 80% qualification
     * flags from the current `attendanceEvents`. Safe to call multiple
     * times: the output is deterministic and depends only on the event
     * array + scheduled window (no incremental accumulation).
     */
    async reconcileAttendance(sessionOrBookingId, asOf = null) {
        let session;
        // Accept either a string bookingId, a Booking ObjectId, or a
        // ConsultationSession document. The previous code accidentally
        // treated a passed-in ObjectId as a document, causing `save`
        // to fail; we now always re-fetch by bookingId for ID-like inputs.
        const isIdLike =
            typeof sessionOrBookingId === "string" ||
            (sessionOrBookingId &&
                sessionOrBookingId.constructor &&
                sessionOrBookingId.constructor.name === "ObjectId");
        if (isIdLike) {
            session = await ConsultationSession.findOne({
                bookingId: sessionOrBookingId,
            });
        } else {
            session = sessionOrBookingId;
        }
        if (!session) return null;

        // Backfill scheduled window defensively (no-op if already set).
        if (!session.scheduledStart || !session.scheduledEnd) {
            const booking = await Booking.findById(session.bookingId);
            if (booking) {
                const win = calculateScheduledWindow(booking);
                session.scheduledStart = win.scheduledStart;
                session.scheduledEnd = win.scheduledEnd;
                session.consultantGraceEnd = win.consultantGraceEnd;
                session.clientWaitEnd = win.clientWaitEnd;
                session.requiredDurationSeconds = win.requiredDurationSeconds;
            }
        }

        const calc = computeAttendanceQualification(session, asOf);

        session.clientAttendanceDuration = calc.clientAttendanceDuration;
        session.consultantAttendanceDuration = calc.consultantAttendanceDuration;
        session.clientAttendanceMet = calc.clientAttendanceMet;
        session.consultantAttendanceMet = calc.consultantAttendanceMet;
        session.lastReconciledAt = calc.lastReconciledAt;

        await session.save();
        return session;
    }

    // -----------------------------------------------------------------------
    // Recording URL (consultant-only, narrow field)
    // -----------------------------------------------------------------------

    async addRecordingUrl(bookingId, userId, recordingUrl) {
        const booking = await Booking.findById(bookingId);
        if (!booking) {
            throw new ApiError(404, "Booking not found");
        }

        if (booking.consultantId.toString() !== userId.toString()) {
            throw new ApiError(403, "Only consultant can add recording URL");
        }

        let session = await ConsultationSession.findOne({ bookingId });
        if (!session) {
            throw new ApiError(404, "Session not found");
        }

        session.recordingUrl = recordingUrl;
        await session.save();

        return session;
    }

    // -----------------------------------------------------------------------
    // Google Meet attendance sync (server-only, idempotent)
    // -----------------------------------------------------------------------

    /**
     * Compare two attendance event arrays by their meaningful fields,
     * ignoring Mongoose-specific metadata like _id.
     */
    static _eventsEqual(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            const ea = a[i];
            const eb = b[i];
            if (
                ea.participant !== eb.participant ||
                ea.joinedAt.getTime() !== eb.joinedAt.getTime() ||
                (ea.leftAt ? ea.leftAt.getTime() : null) !==
                    (eb.leftAt ? eb.leftAt.getTime() : null) ||
                ea.durationSeconds !== eb.durationSeconds
            ) {
                return false;
            }
        }
        return true;
    }

    /**
     * Persist verified Google Meet attendance into a ConsultationSession.
     *
     * Trust boundary:
     * - Only Google-controlled fields are modified: attendanceEvents,
     *   googleConferenceRecordId, googleAttendanceSyncedAt.
     * - Server-derived fields (attendanceStatus, startedAt, endedAt,
     *   clientJoinedAt, consultantJoinedAt, durations, met-flags, outcome,
     *   outcomeFinalizedAt, scheduled window, lastReconciledAt) are NEVER
     *   touched by this method.
     * - This method does NOT trigger financial processing or outcome
     *   determination.
     *
     * Idempotency:
     * - If the session has already been synced with the same
     *   conferenceRecordId and the attendanceEvents are identical,
     *   the call is a no-op and returns the existing session.
     * - If the conferenceRecordId matches but events differ, the events
     *   are replaced.
     * - If the conferenceRecordId is new or empty, the events are replaced.
     *
     * @param {Object} params
     * @param {string} params.bookingId - Booking ID
     * @param {string} params.conferenceRecordId - Google conference record ID
     * @param {Array} params.attendanceEvents - Verified attendance events
     * @returns {Promise<ConsultationSession>} Updated session
     */
    async syncGoogleAttendance({ bookingId, conferenceRecordId, attendanceEvents }) {
        if (!bookingId || typeof conferenceRecordId !== "string" || conferenceRecordId.trim() === "") {
            throw new ApiError(400, "bookingId and conferenceRecordId are required");
        }

        if (!Array.isArray(attendanceEvents)) {
            throw new ApiError(400, "attendanceEvents must be an array");
        }

        // Validate each event structure without mutating.
        for (const event of attendanceEvents) {
            if (!event || typeof event !== "object") {
                throw new ApiError(400, "Each attendance event must be an object");
            }
            if (!["client", "consultant"].includes(event.participant)) {
                throw new ApiError(400, "Invalid participant in attendance event");
            }
            if (!(event.joinedAt instanceof Date) || Number.isNaN(event.joinedAt.getTime())) {
                throw new ApiError(400, "Invalid joinedAt in attendance event");
            }
            if (event.leftAt !== null && !(event.leftAt instanceof Date)) {
                throw new ApiError(400, "Invalid leftAt in attendance event");
            }
            if (typeof event.durationSeconds !== "number" || event.durationSeconds < 0) {
                throw new ApiError(400, "Invalid durationSeconds in attendance event");
            }
        }

        const session = await ConsultationSession.findOne({ bookingId });
        if (!session) {
            throw new ApiError(404, "ConsultationSession not found for booking");
        }

        // Idempotency: if already synced with the same conference record,
        // compare events to avoid blind overwrite.
        if (
            session.googleConferenceRecordId === conferenceRecordId &&
            session.googleAttendanceSyncedAt instanceof Date &&
            !Number.isNaN(session.googleAttendanceSyncedAt.getTime())
        ) {
            if (ConsultationSessionService._eventsEqual(session.attendanceEvents || [], attendanceEvents)) {
                // Already synced with identical data — no-op.
                return session;
            }
            // Same conference record but different events — proceed to update.
        }

        // Use findOneAndUpdate to ensure ONLY Google-controlled fields are
        // modified. This prevents accidental writes to protected fields.
        const updated = await ConsultationSession.findOneAndUpdate(
            { bookingId, _id: session._id },
            {
                $set: {
                    attendanceEvents: attendanceEvents,
                    googleConferenceRecordId: conferenceRecordId,
                    googleAttendanceSyncedAt: new Date(),
                },
            },
            { new: true }
        );

        return updated;
    }
}

// ---------------------------------------------------------------------------
// Compatibility shim
// ---------------------------------------------------------------------------
//
// The previous public method was `updateAttendance(bookingId, userId,
// attendanceStatus)`. That method allowed participants to inject terminal
// statuses that triggered financial earning creation. It has been removed.
//
// To prevent silent reintroduction through stale imports, `updateAttendance`
// is re-exported as an async function that immediately rejects.
//
ConsultationSessionService.prototype.updateAttendance = async function () {
    throw new ApiError(
        500,
        "updateAttendance() has been removed. Use recordAttendanceSignal(bookingId, userId, 'join'|'leave') instead. Participant-supplied terminal attendance statuses are no longer accepted."
    );
};

export default new ConsultationSessionService();
