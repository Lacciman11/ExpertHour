/**
 * ReviewRequestService — Phase 3B.6
 *
 * Background worker that asks the CLIENT to review a consultation session one
 * hour after the session is finalized as COMPLETED.
 *
 * Design principles (mirroring booking-reminder.service.js):
 *   1. The consultant is NEVER a recipient. Only the client is asked.
 *   2. Timing is anchored on the server-derived
 *      `ConsultationSession.outcomeFinalizedAt` — never on `scheduledStart`,
 *      the booking date, or any client-controlled timestamp.
 *   3. Eligibility is filtered IN the discovery query, before `$limit`, so
 *      already-reviewed or ineligible sessions can never consume batch slots
 *      and starve eligible clients.
 *   4. Idempotency is delegated to the unique indexes that already exist:
 *      `Notification.dedupeKey` and `EmailOutbox.dedupeKey`. There is
 *      deliberately no read-before-write check, because that pattern is racy.
 *   5. This worker NEVER mutates a session outcome, a booking, or a review.
 *      It is a pure downstream consumer of already-committed state.
 *   6. In-app and email are independent channels: a failure in one never
 *      suppresses the other, and a failure for one session never terminates
 *      the cycle.
 *
 * Scope: in-app notification + durable email-outbox job. This worker never
 * calls SMTP directly; email is queued and delivered by the outbox worker.
 */

import ConsultationSession from "../models/ConsultationSession.js";
import Booking from "../models/Booking.js";
import Review from "../models/Review.js";
import User from "../models/User.js";

import env from "../config/env.js";
import paymentLogger from "../utils/logger.js";
import { SESSION_OUTCOME, NOTIFICATION_CATEGORY, EMAIL_TEMPLATE_ID } from "../utils/constants.js";
import domainNotificationEmitter from "./domain-notification.emitter.js";
import emailOutboxService from "./email-outbox.service.js";

const { intervalMs, batchSize, delayMs } = env.reviewRequest;

/**
 * Stable, dot-namespaced notification type. Distinct from "review.received"
 * (which notifies the consultant AFTER a review exists), so the two dedupe
 * keys can never collide.
 */
const NOTIFICATION_TYPE = "review.request";

const TITLE = "Please review your session";
const BODY = "Your consultation session has been completed. Share your feedback to help other businesses.";

class ReviewRequestService {

    constructor() {

        this.isRunning = false;

        this.shutdownRequested = false;

        this.timerId = null;

        this.batchSize = batchSize;

    }

    /**
     * Start the review-request worker. Must be called after MongoDB is
     * connected. Duplicate startup is prevented by the `isRunning` guard.
     */
    start() {

        if (this.isRunning) {

            paymentLogger.info("review_request_worker_already_running", {
                event: "review_request_worker_already_running",
            });

            return;

        }

        this.isRunning = true;

        this.shutdownRequested = false;

        paymentLogger.info("review_request_worker_starting", {
            event: "review_request_worker_starting",
            intervalMs,
            batchSize: this.batchSize,
            delayMs,
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

        paymentLogger.info("review_request_worker_shutdown_requested", {
            event: "review_request_worker_shutdown_requested",
        });

    }

    /**
     * Schedule the next cycle. Recursive setTimeout prevents overlapping runs.
     */
    _scheduleNext() {

        if (this.shutdownRequested) {

            this.isRunning = false;

            paymentLogger.info("review_request_worker_stopped", {
                event: "review_request_worker_stopped",
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
    // Discovery
    // -------------------------------------------------------------------

    /**
     * Find sessions that are due for a review request.
     *
     * Every eligibility rule is applied IN the query, before `$limit`, so
     * ineligible sessions cannot occupy batch slots:
     *
     *   1. `outcome === COMPLETED` and `outcomeFinalizedAt` is set and at
     *      least `delayMs` old (anchored on the server-derived timestamp).
     *   2. The booking exists (`$unwind` drops sessions with no booking).
     *   3. The booking is not cancelled (`cancelledAt === null`).
     *   4. No Review exists for the session's `bookingId`
     *      (`$lookup` + `review: { $eq: [] }`).
     *
     * Deterministic ordering by `outcomeFinalizedAt` ascending, then `$limit`,
     * guarantees forward progress across cycles.
     *
     * Collection names are read from the models at runtime so the `$lookup`
     * stages can never drift from Mongoose's pluralisation.
     *
     * @param {Date} now - injected clock
     * @returns {Promise<Array<{session: object, booking: object}>>}
     * @private
     */
    async _findDueReviewRequests(now) {

        const cutoff = new Date(now.getTime() - delayMs);

        const sessions = await ConsultationSession.aggregate([
            {
                $match: {
                    outcome: SESSION_OUTCOME.COMPLETED,
                    outcomeFinalizedAt: { $ne: null, $lte: cutoff },
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
            // Drops sessions whose booking is missing.
            { $unwind: "$booking" },
            {
                $match: {
                    "booking.cancelledAt": null,
                },
            },
            {
                $lookup: {
                    from: Review.collection.name,
                    localField: "bookingId",
                    foreignField: "bookingId",
                    as: "review",
                },
            },
            // Keeps only sessions with NO existing review for the booking.
            {
                $match: {
                    review: { $eq: [] },
                },
            },
            { $sort: { outcomeFinalizedAt: 1, _id: 1 } },
            { $limit: this.batchSize },
        ]);

        return sessions.map((session) => ({
            session,
            booking: session.booking,
        }));

    }

    // -------------------------------------------------------------------
    // Emission
    // -------------------------------------------------------------------

    /**
     * Emit one review request for one session: in-app to the client, then an
     * email-outbox job to the client. Both channels are failure-isolated and
     * independently idempotent.
     *
     * The consultant is deliberately not a recipient.
     *
     * @param {object} session - a ConsultationSession (lean, from aggregate)
     * @param {object} booking - the session's Booking (lean, from aggregate)
     * @private
     */
    async _emitReviewRequest(session, booking) {

        const sessionId = session._id;

        const clientId = booking.clientId;

        // In-app: the emitter isolates the failure and dedupes by
        // `${type}:${recipientId}:${sessionId}`. A missing client user makes
        // `notificationService.create()` throw 404, which the emitter swallows.
        await domainNotificationEmitter.emitToRecipients({
            category: NOTIFICATION_CATEGORY.REVIEW,
            type: NOTIFICATION_TYPE,
            subjectId: sessionId.toString(),
            recipients: [
                {
                    recipientId: clientId,
                    title: TITLE,
                    body: BODY,
                    data: {
                        bookingId: booking._id,
                        sessionId,
                        deepLinkPath: `/dashboard/client/bookings/${booking._id}/review`,
                    },
                },
            ],
        });

        // Email: one job, isolated. A failure here never affects the in-app
        // notification above.
        await this._enqueueReviewRequestEmail(clientId, sessionId);

    }

    /**
     * Resolve the client's account and enqueue a review-request email. A
     * missing user or missing address is skipped; enqueue failures are logged
     * and swallowed so they never affect the in-app channel or the cycle.
     *
     * Privacy: the recipient is the client's User id and the destination is
     * `User.email` — never a Google Calendar email or a consultant profile
     * email. The payload carries only `firstName`. Only safe identifiers and
     * `error.message` are logged.
     *
     * @param {string|object} clientUserId - the client's User id
     * @param {string|object} sessionId - the session id (dedupe subject)
     * @private
     */
    async _enqueueReviewRequestEmail(clientUserId, sessionId) {

        try {

            const user = await User.findById(clientUserId);

            if (!user || !user.email) {
                return;
            }

            await emailOutboxService.enqueue({
                recipientId: clientUserId,
                to: user.email,
                category: NOTIFICATION_CATEGORY.REVIEW,
                templateId: EMAIL_TEMPLATE_ID.REVIEW_REQUEST,
                templateData: { firstName: user.firstName },
                dedupeKey: emailOutboxService.buildDedupeKey(
                    EMAIL_TEMPLATE_ID.REVIEW_REQUEST,
                    clientUserId.toString(),
                    sessionId.toString()
                ),
            });

        } catch (error) {

            paymentLogger.error("review_request_email_enqueue_failed", {
                event: "review_request_email_enqueue_failed",
                sessionId: sessionId.toString(),
                error: error?.message || error,
            });

        }

    }

    // -------------------------------------------------------------------
    // Cycle
    // -------------------------------------------------------------------

    /**
     * Execute one review-request cycle.
     * @param {Date} [now] - injected clock (defaults to the wall clock)
     * @returns {Promise<object>} cycle counters
     */
    async _runCycle(now = new Date()) {

        const cycleStart = Date.now();

        paymentLogger.info("review_request_cycle_started", {
            event: "review_request_cycle_started",
            cycleStart: new Date(cycleStart).toISOString(),
        });

        const counters = { processed: 0 };

        try {

            const due = await this._findDueReviewRequests(now);

            for (const { session, booking } of due) {

                try {

                    await this._emitReviewRequest(session, booking);

                    counters.processed += 1;

                } catch (error) {

                    // One session's failure must never terminate the cycle.
                    paymentLogger.error("review_request_emit_failed", {
                        event: "review_request_emit_failed",
                        sessionId: String(session._id),
                        error: error?.message || error,
                    });

                }

            }

            paymentLogger.info("review_request_cycle_completed", {
                event: "review_request_cycle_completed",
                cycleDurationMs: Date.now() - cycleStart,
                ...counters,
            });

        } catch (error) {

            // A cycle-level failure is logged but never fatal.
            paymentLogger.error("review_request_cycle_failed", {
                event: "review_request_cycle_failed",
                error: error?.message || error,
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

export default new ReviewRequestService();
