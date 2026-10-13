import notificationService from "./notification.service.js";
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
