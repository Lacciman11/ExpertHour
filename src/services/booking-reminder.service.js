import ConsultationSession from "../models/ConsultationSession.js";
import Booking from "../models/Booking.js";
import User from "../models/User.js";

import env from "../config/env.js";
import paymentLogger from "../utils/logger.js";
import { NOTIFICATION_CATEGORY, EMAIL_TEMPLATE_ID, BOOKING_STATUS } from "../utils/constants.js";
import domainNotificationEmitter from "./domain-notification.emitter.js";
import emailOutboxService from "./email-outbox.service.js";

const { intervalMs, batchSize, lead24hMs, lead1hMs } = env.bookingReminder;

/**
 * BookingReminderService
 *
 * Background worker that reminds both participants of an upcoming confirmed
 * consultation at two lead times: 24 hours and 1 hour before
 * `ConsultationSession.scheduledStart`.
 *
 * Each reminder is evaluated independently against its own due instant
 * (`scheduledStart - lead`). A reminder is due when `now >= scheduledStart - lead`
 * and the session has not started (`now < scheduledStart`). This is a
 * per-reminder window, so the 1-hour reminder never fires merely because a
 * session falls within 24 hours, and neither fires at or after `scheduledStart`.
 *
 * Eligibility (all must hold):
 *   - the booking exists and `status === CONFIRMED`
 *   - the booking has not been cancelled (`cancelledAt` is null)
 *   - `ConsultationSession.outcome === null` (not finalized)
 *   - the session has not started (`scheduledStart > now`)
 *
 * Idempotency: each (reminder type, recipient, session) has a deterministic
 * dedupe key. The in-app notification and the email-outbox job each carry their
 * own key, so repeated cycles, worker restarts, and concurrent runs cannot
 * create duplicate logical reminders. The two channels are independent: a
 * failure in one does not suppress the other.
 *
 * In-app + email only. This worker never calls SMTP directly; email is queued
 * through the durable outbox and delivered by the outbox worker.
 */

const REMINDERS = [
    {
        type: "booking.reminder_24h",
        leadMs: lead24hMs,
        templateId: EMAIL_TEMPLATE_ID.BOOKING_REMINDER_24H,
        label: "24 hours",
        title: "Session in 24 hours",
        body: "Reminder: your consultation session starts in 24 hours.",
    },
    {
        type: "booking.reminder_1h",
        leadMs: lead1hMs,
        templateId: EMAIL_TEMPLATE_ID.BOOKING_REMINDER_1H,
        label: "1 hour",
        title: "Session in 1 hour",
        body: "Reminder: your consultation session starts in 1 hour.",
    },
];

class BookingReminderService {

    constructor() {

        this.isRunning = false;

        this.shutdownRequested = false;

        this.timerId = null;

        this.batchSize = batchSize;

    }

    /**
     * Start the reminder worker. Must be called after MongoDB is connected.
     */
    start() {

        if (this.isRunning) {

            paymentLogger.info("booking_reminder_worker_already_running", {
                event: "booking_reminder_worker_already_running",
            });

            return;

        }

        this.isRunning = true;

        this.shutdownRequested = false;

        paymentLogger.info("booking_reminder_worker_starting", {
            event: "booking_reminder_worker_starting",
            intervalMs,
            batchSize: this.batchSize,
            lead24hMs,
            lead1hMs,
        });

        this._scheduleNext();

    }

    /**
     * Request graceful shutdown. The current cycle finishes; no new cycle starts.
     */
    stop() {

        this.shutdownRequested = true;

        this.isRunning = false;

        if (this.timerId) {

            clearTimeout(this.timerId);

            this.timerId = null;

        }

        paymentLogger.info("booking_reminder_worker_shutdown_requested", {
            event: "booking_reminder_worker_shutdown_requested",
        });

    }

    /**
     * Schedule the next cycle. Recursive setTimeout prevents overlapping runs.
     */
    _scheduleNext() {

        if (this.shutdownRequested) {

            this.isRunning = false;

            paymentLogger.info("booking_reminder_worker_stopped", {
                event: "booking_reminder_worker_stopped",
            });

            return;

        }

        this.timerId = setTimeout(() => {

            this._runCycle().finally(() => {

                this._scheduleNext();

            });

        }, intervalMs);

    }

    /**
     * Find sessions for which a given reminder is currently due.
     *
     * Due window: `now < scheduledStart <= now + leadMs` (not started, and the
     * reminder instant has arrived). `outcome: null` excludes finalized sessions.
     *
     * @param {object} reminder - a REMINDERS entry
     * @param {Date} now - injected clock
     * @returns {Promise<Array<{session: object, booking: object|null}>>}
     * @private
     */
    async _findDueReminders(reminder, now) {

        const windowEnd = new Date(now.getTime() + reminder.leadMs);

        // Filter eligible bookings IN the query (via $lookup) so ineligible
        // sessions — pending or cancelled bookings — never consume batch slots
        // and starve eligible confirmed sessions. The booking-status $match runs
        // BEFORE $limit, so the batch contains only eligible sessions no matter
        // how many ineligible ones share the window. Deterministic ordering plus
        // the sliding window (its lower bound advances with `now`) guarantee
        // progress across cycles.
        const sessions = await ConsultationSession.aggregate([
            {
                $match: {
                    outcome: null,
                    scheduledStart: { $gt: now, $lte: windowEnd },
                },
            },
            {
                $lookup: {
                    from: Booking.collection.name,
                    localField: "bookingId",
                    foreignField: "_id",
                    as: "booking",
                },
            },
            { $unwind: "$booking" },
            {
                $match: {
                    "booking.status": BOOKING_STATUS.CONFIRMED,
                    "booking.cancelledAt": null,
                },
            },
            { $sort: { scheduledStart: 1 } },
            { $limit: this.batchSize },
        ]);

        return sessions.map((session) => ({
            session,
            booking: session.booking,
        }));
    }

    /**
     * True when the booking is eligible for a reminder: confirmed and not
     * cancelled.
     * @private
     */
    _isBookingEligible(booking) {

        if (!booking) {
            return false;
        }

        if (booking.status !== BOOKING_STATUS.CONFIRMED) {
            return false;
        }

        if (booking.cancelledAt) {
            return false;
        }

        return true;

    }

    /**
     * Emit one reminder for one session: in-app to both participants, then an
     * email-outbox job to each. Both channels are failure-isolated and
     * independently idempotent.
     * @private
     */
    async _emitReminder(reminder, session, booking) {

        const sessionId = session._id;

        const recipients = [
            { recipientId: booking.clientId, deepLinkPath: "/dashboard/client/bookings" },
            { recipientId: booking.consultantId, deepLinkPath: "/dashboard/consultant/bookings" },
        ];

        // In-app: the emitter isolates per-recipient failures and dedupes by
        // `${type}:${recipientId}:${sessionId}`.
        await domainNotificationEmitter.emitToRecipients({
            category: NOTIFICATION_CATEGORY.BOOKING,
            type: reminder.type,
            subjectId: sessionId.toString(),
            recipients: recipients.map((r) => ({
                recipientId: r.recipientId,
                title: reminder.title,
                body: reminder.body,
                data: {
                    sessionId,
                    bookingId: booking._id,
                    deepLinkPath: r.deepLinkPath,
                },
            })),
        });

        // Email: one job per recipient, each isolated.
        for (const r of recipients) {
            await this._enqueueReminderEmail(r.recipientId, sessionId, reminder);
        }

    }

    /**
     * Resolve the recipient's account and enqueue a reminder email. Missing
     * user/email is skipped; enqueue failures are logged and swallowed so they
     * never affect the in-app channel or the worker cycle.
     * @private
     */
    async _enqueueReminderEmail(recipientUserId, sessionId, reminder) {
        try {

            const user = await User.findById(recipientUserId);

            if (!user || !user.email) {
                return;
            }

            await emailOutboxService.enqueue({
                recipientId: recipientUserId,
                to: user.email,
                category: NOTIFICATION_CATEGORY.BOOKING,
                templateId: reminder.templateId,
                templateData: { firstName: user.firstName, reminderLabel: reminder.label },
                dedupeKey: emailOutboxService.buildDedupeKey(
                    reminder.templateId,
                    recipientUserId.toString(),
                    sessionId.toString()
                ),
            });

        } catch (error) {

            paymentLogger.error("booking_reminder_email_enqueue_failed", {
                event: "booking_reminder_email_enqueue_failed",
                sessionId: sessionId.toString(),
                error: error?.message || error,
            });

        }
    }

    /**
     * Execute one reminder cycle. Each reminder type is evaluated independently.
     * @param {Date} [now] - injected clock (defaults to the wall clock)
     * @returns {Promise<object>} cycle counters
     */
    async _runCycle(now = new Date()) {

        const cycleStart = Date.now();

        paymentLogger.info("booking_reminder_cycle_started", {
            event: "booking_reminder_cycle_started",
            cycleStart: new Date(cycleStart).toISOString(),
        });

        const counters = { processed: 0 };
        for (const reminder of REMINDERS) {
            counters[reminder.type] = 0;
        }

        try {

            for (const reminder of REMINDERS) {

                const due = await this._findDueReminders(reminder, now);

                for (const { session, booking } of due) {

                    if (!this._isBookingEligible(booking)) {
                        continue;
                    }

                    counters.processed += 1;
                    counters[reminder.type] += 1;

                    await this._emitReminder(reminder, session, booking);

                }

            }

            paymentLogger.info("booking_reminder_cycle_completed", {
                event: "booking_reminder_cycle_completed",
                cycleDurationMs: Date.now() - cycleStart,
                ...counters,
            });

        } catch (error) {

            // A cycle-level failure is logged but never fatal.
            paymentLogger.error("booking_reminder_cycle_failed", {
                event: "booking_reminder_cycle_failed",
                error: error.message,
                ...counters,
            });

        }

        return counters;

    }

    /**
     * Manually trigger a cycle (admin/testing). Not governed by the shutdown flag.
     * @param {Date} [now] - injected clock
     */
    async processNow(now = new Date()) {

        return this._runCycle(now);

    }

}

export default new BookingReminderService();
