/**
 * Google Meet Attendance Synchronization Worker
 *
 * Periodic worker that discovers bookings requiring Google Meet attendance
 * synchronization and delegates to:
 *
 *   syncBookingAttendance({ bookingId })
 *
 * This worker does NOT:
 *   - calculate session outcomes
 *   - modify attendance status
 *   - calculate earnings
 *   - create payouts
 *   - trigger refunds
 *   - modify payment state
 *   - modify booking state
 *   - create ConsultationSessions
 *   - perform Google OAuth
 *   - call Google APIs directly
 *
 * Design principles:
 *   1. Discovers bookings with Google Meet Space IDs that need attendance sync.
 *   2. Delegates to google-meet-sync.service.js for all Google API interaction.
 *   3. Uses recursive setTimeout (matching project pattern).
 *   4. No overlapping cycles.
 *   5. Configuration from environment/config.
 *   6. Clean shutdown.
 *   7. Continues processing if one booking fails.
 */

import mongoose from "mongoose";

import Booking from "../models/Booking.js";
import ConsultationSession from "../models/ConsultationSession.js";
import GoogleMeetSyncService from "./google-meet-sync.service.js";
import env from "../config/env.js";
import paymentLogger from "../utils/logger.js";
import { BOOKING_STATUS } from "../utils/constants.js";

const { intervalMs, syncRetryIntervalMs, batchSize } = env.googleMeetAttendance;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine if a booking is eligible for Google Meet attendance sync.
 *
 * Eligibility criteria:
 *   - Booking has a non-empty googleConferenceId
 *   - Booking is not cancelled
 *   - Booking has a ConsultationSession
 *   - The session's scheduledEnd has passed (meeting is over)
 *   - The session has not been synced recently (googleAttendanceSyncedAt is
 *     null or older than syncRetryIntervalMs)
 */
function isEligibleForSync(booking, session, now) {
    if (!booking.googleConferenceId || booking.googleConferenceId.trim() === "") {
        return false;
    }

    if (booking.status === BOOKING_STATUS.CANCELLED) {
        return false;
    }

    if (!session) {
        return false;
    }

    if (!session.scheduledStart || !session.scheduledEnd) {
        return false;
    }

    const scheduledEnd = new Date(session.scheduledEnd).getTime();
    if (now.getTime() < scheduledEnd) {
        return false;
    }

    if (session.googleAttendanceSyncedAt) {
        const lastSync = new Date(session.googleAttendanceSyncedAt).getTime();
        const retryThreshold = now.getTime() - syncRetryIntervalMs;
        if (lastSync >= retryThreshold) {
            return false;
        }
    }

    return true;
}

// ---------------------------------------------------------------------------
// Worker Class
// ---------------------------------------------------------------------------

class GoogleMeetAttendanceWorker {

    constructor() {
        this.isRunning = false;
        this.shutdownRequested = false;
        this.timerId = null;
        this.batchSize = batchSize;
    }

    // -------------------------------------------------------------------
    // Lifecycle (recursive setTimeout, matching project pattern)
    // -------------------------------------------------------------------

    start() {
        if (this.isRunning) {
            paymentLogger.info("google_meet_attendance_worker_already_running", {
                event: "google_meet_attendance_worker_already_running",
            });
            return;
        }

        this.isRunning = true;
        this.shutdownRequested = false;

        paymentLogger.info("google_meet_attendance_worker_starting", {
            event: "google_meet_attendance_worker_starting",
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

        this.isRunning = false;

        paymentLogger.info("google_meet_attendance_worker_shutdown_requested", {
            event: "google_meet_attendance_worker_shutdown_requested",
        });
    }

    _scheduleNext() {
        if (this.shutdownRequested) {
            this.isRunning = false;
            paymentLogger.info("google_meet_attendance_worker_stopped", {
                event: "google_meet_attendance_worker_stopped",
            });
            return;
        }

        this.timerId = setTimeout(() => {
            this._runCycle().finally(() => {
                this._scheduleNext();
            });
        }, intervalMs);
    }

    // -------------------------------------------------------------------
    // Cycle Execution
    // -------------------------------------------------------------------

    async _runCycle() {
        const cycleStart = Date.now();

        paymentLogger.info("google_meet_attendance_cycle_started", {
            event: "google_meet_attendance_cycle_started",
            cycleStart: new Date(cycleStart).toISOString(),
        });

        let discovered = 0;
        let processed = 0;
        let succeeded = 0;
        let failed = 0;
        let skipped = 0;

        try {
            const now = new Date();

            // Find ConsultationSessions that may need sync.
            // We look for sessions where googleAttendanceSyncedAt is null or
            // older than the retry threshold, and the session has ended.
            const sessions = await ConsultationSession.find({
                $or: [
                    { googleAttendanceSyncedAt: null },
                    { googleAttendanceSyncedAt: { $lt: new Date(now.getTime() - syncRetryIntervalMs) } },
                ],
                scheduledEnd: { $lte: now },
            })
                .limit(this.batchSize)
                .lean();

            discovered = sessions.length;

            // Bulk-load associated bookings.
            const sessionBookingIds = sessions
                .map((s) => String(s.bookingId))
                .filter(Boolean);
            const uniqueBookingIds = [...new Set(sessionBookingIds)];

            const bookings = await Booking.find({
                _id: { $in: uniqueBookingIds.map((id) => new mongoose.Types.ObjectId(id)) },
            }).lean();

            const bookingById = new Map(
                bookings.map((b) => [String(b._id), b])
            );

            for (const session of sessions) {
                processed += 1;

                const booking = bookingById.get(String(session.bookingId));

                if (!isEligibleForSync(booking, session, now)) {
                    skipped += 1;
                    continue;
                }

                try {
                    const result = await GoogleMeetSyncService.syncBookingAttendance({
                        bookingId: String(session.bookingId),
                    });

                    if (result && result.synced) {
                        succeeded += 1;
                        paymentLogger.info("google_meet_attendance_synced", {
                            event: "google_meet_attendance_synced",
                            bookingId: String(session.bookingId),
                            sessionId: String(session._id),
                            conferenceRecordId: result.conferenceRecordId,
                        });
                    } else if (result && result.synced === false && result.reason === "CONFERENCE_RECORD_NOT_FOUND") {
                        // Record the attempt so we don't retry until syncRetryIntervalMs passes.
                        await ConsultationSession.findByIdAndUpdate(session._id, {
                            googleAttendanceSyncedAt: new Date(),
                        });
                        skipped += 1;
                    } else {
                        failed += 1;
                        paymentLogger.warn("google_meet_attendance_sync_unexpected", {
                            event: "google_meet_attendance_sync_unexpected",
                            bookingId: String(session.bookingId),
                            sessionId: String(session._id),
                            result,
                        });
                    }
                } catch (err) {
                    // Record the failed attempt so we don't retry until syncRetryIntervalMs passes.
                    await ConsultationSession.findByIdAndUpdate(session._id, {
                        googleAttendanceSyncedAt: new Date(),
                    });
                    failed += 1;
                    paymentLogger.error("google_meet_attendance_sync_failed", {
                        event: "google_meet_attendance_sync_failed",
                        bookingId: String(session.bookingId),
                        sessionId: String(session._id),
                        error: err.message,
                    });
                }
            }

        } catch (error) {
            paymentLogger.error("google_meet_attendance_cycle_failed", {
                event: "google_meet_attendance_cycle_failed",
                error: error.message,
            });
        }

        paymentLogger.info("google_meet_attendance_cycle_completed", {
            event: "google_meet_attendance_cycle_completed",
            discovered,
            processed,
            succeeded,
            failed,
            skipped,
            cycleDurationMs: Date.now() - cycleStart,
        });
    }

}

// ---------------------------------------------------------------------------
// Export class for testing
// ---------------------------------------------------------------------------

export { GoogleMeetAttendanceWorker };

// ---------------------------------------------------------------------------
// Export Singleton
// ---------------------------------------------------------------------------

export default new GoogleMeetAttendanceWorker();
