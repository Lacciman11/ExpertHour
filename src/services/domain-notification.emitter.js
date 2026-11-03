import notificationService from "./notification.service.js";
import notificationRealtime from "../realtime/notification.socket.js";
import paymentLogger from "../utils/logger.js";
import { NOTIFICATION_CATEGORY } from "../utils/constants.js";

/**
 * DomainNotificationEmitter — Phase 3B.1 / Stage 9.6C.1
 *
 * Shared, failure-isolated helper for emitting in-app notifications from
 * domain events (booking, consultation, review) and operational admin alerts.
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
 * create in-app records for admins. Operational alerts are persisted as
 * `admin`-category notifications addressed to each active administrator.
 *
 * Known limitation: operational alerts are in-app records only. If MongoDB is
 * unavailable, `notificationService.create()` cannot persist them and the
 * emitter returns `{ ok: false }`; the calling financial operation is never
 * affected. Email fallback for operational alerts is a later phase.
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
    severity,
    operational = false,
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
            severity,
            operational,
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

/**
 * Emit one operational alert to a single administrator.
 *
 * Wraps `emitOne()` with the admin-specific category and the operational
 * payload flag so the notification service uses the operational data
 * allowlist. Failures are swallowed and logged; this function never throws.
 *
 * @param {object} params
 * @param {string} params.recipientId - Admin user id to notify
 * @param {string} params.type - stable event identifier, e.g.
 *   "operational.payment_reconciliation.transient_errors"
 * @param {string} params.title - headline
 * @param {string} params.body - message body
 * @param {string} params.severity - one of info/warn/error/critical
 * @param {string} params.dedupeKey - idempotency key, unique per recipient
 * @param {object} [params.data] - operational payload (allowlisted)
 * @returns {Promise<{ok: boolean, created: boolean}>}
 * @private
 */
async function emitAdminAlertOne({
    recipientId,
    type,
    title,
    body,
    severity,
    dedupeKey,
    data,
}) {
    return emitOne({
        recipientId,
        category: NOTIFICATION_CATEGORY.ADMIN,
        type,
        title,
        body,
        dedupeKey,
        data,
        severity,
        operational: true,
    });
}

/**
 * Emit an operational alert to every active administrator.
 *
 * Recipient resolution is delegated to `notificationService.listAdminUsers()`.
 * Each administrator receives an independently deduplicated notification, so
 * a repeated alert with the same dedupe key never creates duplicates for a
 * given administrator.
 *
 * Failure isolation:
 *   - If no administrator exists, a structured warning is logged and the
 *     function returns `{ attempted: 0, succeeded: 0, created: 0 }` without
 *     throwing.
 *   - If recipient resolution fails, the error is logged and the function
 *     returns the same zeroed result. The calling financial operation is never
 *     affected.
 *   - If notification creation fails for one administrator, that failure is
 *     logged and isolated; other administrators are still attempted.
 *
 * @param {object} params
 * @param {string} params.type - stable event identifier
 * @param {string} params.title - headline
 * @param {string} params.body - message body
 * @param {string} params.severity - one of info/warn/error/critical
 * @param {string} params.dedupeKey - idempotency key, unique per recipient
 * @param {object} [params.data] - operational payload (allowlisted)
 * @returns {Promise<{attempted: number, succeeded: number, created: number}>}
 */
async function emitAdminAlert({
    type,
    title,
    body,
    severity,
    dedupeKey,
    data,
}) {
    let attempted = 0;
    let succeeded = 0;
    let created = 0;

    let admins;
    try {
        admins = await notificationService.listAdminUsers();
    } catch (resolutionError) {
        // Recipient resolution failed. Log and return zeroed: the calling
        // financial operation must never be affected by alerting.
        paymentLogger.error("admin_alert_recipient_resolution_failed", {
            event: "admin_alert_recipient_resolution_failed",
            alertType: type,
            error: resolutionError?.message || resolutionError,
        });
        return { attempted, succeeded, created };
    }

    if (!admins || admins.length === 0) {
        paymentLogger.warn("admin_alert_no_administrators", {
            event: "admin_alert_no_administrators",
            alertType: type,
        });
        return { attempted, succeeded, created };
    }

    for (const admin of admins) {
        const recipientId = admin && admin._id ? String(admin._id) : null;
        if (!recipientId) {
            paymentLogger.warn("admin_alert_recipient_skipped", {
                event: "admin_alert_recipient_skipped",
                alertType: type,
                reason: "missing_recipient_id",
            });
            continue;
        }

        attempted += 1;

        // Each administrator must receive an independently deduplicated
        // notification. The caller-supplied `dedupeKey` identifies the logical
        // alert; we scope it per recipient so a repeated alert never creates
        // duplicates for a given administrator while still allowing every
        // administrator to receive it. The unique index on dedupeKey handles
        // the rest, including concurrency.
        const recipientDedupeKey = `${dedupeKey}:${recipientId}`;

        const result = await emitAdminAlertOne({
            recipientId,
            type,
            title,
            body,
            severity,
            dedupeKey: recipientDedupeKey,
            data,
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
    emitAdminAlert,
    emitAdminAlertOne,
};
