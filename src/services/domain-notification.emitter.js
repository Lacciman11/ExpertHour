import notificationService from "./notification.service.js";
import notificationRealtime from "../realtime/notification.socket.js";
import paymentLogger from "../utils/logger.js";

/**
 * DomainNotificationEmitter — Phase 3B.1
 *
 * Shared, failure-isolated helper for emitting in-app notifications from
 * domain events (booking, consultation, review).
 *
 * Design rules:
 *   1. Notification persistence NEVER affects the authoritative business
 *      outcome. Every emission is wrapped so a failure is logged and swallowed.
 *   2. Recipients are isolated: a failure notifying one participant does not
 *      prevent attempting the others.
 *   3. Deduplication is delegated entirely to `notificationService.create()`,
 *      which owns the unique `dedupeKey` index and 11000 handling. This helper
 *      does not duplicate that logic.
 *   4. Only safe identifiers and `error.message` are logged — never bodies,
 *      personal data, tokens, or payment details.
 *
 * Scope: in-app only. This helper does not send email, enqueue outbox jobs, or
 * create in-app records for admins.
 */

/**
 * Emit one notification, swallowing any failure.
 *
 * @param {object} params
 * @param {string} params.recipientId - User id to notify
 * @param {string} params.category - NOTIFICATION_CATEGORY value
 * @param {string} params.type - stable event identifier
 * @param {string} params.title - headline
 * @param {string} params.body - message body
 * @param {string} params.dedupeKey - idempotency key
 * @param {object} [params.data] - safe references / deep link
 * @returns {Promise<{ok: boolean, created: boolean}>}
 * @private
 *
 * On a genuinely new record this also emits a minimal Socket.IO event to the
 * recipient's private room (Phase 3B.7). The event is a cache-invalidation
 * signal only; the database remains the source of truth.
 */
async function emitOne({
    recipientId,
    category,
    type,
    title,
    body,
    dedupeKey,
    data,
}) {
    try {
        const result = await notificationService.create({
            recipientId,
            category,
            type,
            title,
            body,
            dedupeKey,
            data,
        });

        // Real-time announcement. Emitted ONLY after persistence succeeded and
        // ONLY when a genuinely new record was created, so a duplicate
        // dedupeKey never produces a second client-visible event. The payload
        // is a minimal signal; the client refetches authoritative data from
        // the notification API.
        //
        // Best-effort and doubly isolated: the realtime module swallows its
        // own failures, and this narrow try/catch guarantees that even an
        // unexpected throw can never turn a successful persist into a
        // reported failure or undo the persisted record.
        if (result.created && result.notification) {
            try {
                notificationRealtime.emitNotificationCreated(
                    recipientId,
                    result.notification._id
                );
            } catch (realtimeError) {
                paymentLogger.error("domain_notification_realtime_failed", {
                    event: "domain_notification_realtime_failed",
                    notificationType: type,
                    error: realtimeError?.message || realtimeError,
                });
            }
        }

        return { ok: true, created: result.created };

    } catch (error) {
        // A notification failure must never propagate to the domain caller.
        paymentLogger.error("domain_notification_failed", {
            event: "domain_notification_failed",
            notificationType: type,
            error: error?.message || error,
        });

        return { ok: false, created: false };

    }
}

/**
 * Emit the same logical event to several recipients, isolating failures.
 *
 * Each recipient gets its own dedupe key derived from `subjectId`, so a
 * repeated or concurrent emission of the same event for the same recipient is
 * deduplicated by the notification service's unique index.
 *
 * @param {object} params
 * @param {string} params.category - NOTIFICATION_CATEGORY value
 * @param {string} params.type - stable event identifier
 * @param {string} params.subjectId - id of the authoritative domain entity
 * @param {Array<{recipientId: string, title: string, body: string, data?: object}>} params.recipients
 * @returns {Promise<{attempted: number, succeeded: number, created: number}>}
 */
async function emitToRecipients({ category, type, subjectId, recipients }) {
    let attempted = 0;
    let succeeded = 0;
    let created = 0;

    for (const recipient of recipients) {
        if (!recipient || !recipient.recipientId) {
            // A recipient with no usable id is silently skipped above. Log it
            // so a missing notification is observable without changing the
            // skip behaviour. Safe identifiers only: type and subject id.
            paymentLogger.warn("domain_notification_recipient_skipped", {
                event: "domain_notification_recipient_skipped",
                notificationType: type,
                subjectId,
                reason: "missing_recipient_id",
            });

            continue;
        }

        attempted += 1;

        const result = await emitOne({
            recipientId: recipient.recipientId,
            category,
            type,
            title: recipient.title,
            body: recipient.body,
            data: recipient.data,
            // Deterministic, recipient-specific key: the same event re-emitted
            // for the same recipient resolves to the same key.
            dedupeKey: `${type}:${recipient.recipientId}:${subjectId}`,
        });

        if (result.ok) {
            succeeded += 1;
        }

        if (result.created) {
            created += 1;
        }
    }

    return { attempted, succeeded, created };
}

export default {
    emitOne,
    emitToRecipients,
};
