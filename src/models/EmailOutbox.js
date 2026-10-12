import mongoose from "mongoose";

import {
    EMAIL_OUTBOX_STATUS,
    EMAIL_TEMPLATE_ID,
    NOTIFICATION_CATEGORY,
} from "../utils/constants.js";

/**
 * EmailOutbox — durable, retryable email delivery queue.
 *
 * Phase 3A scope: persistence and state transitions only. The background
 * worker that polls this collection is implemented in a later step, and no
 * existing email call site writes to it yet.
 *
 * Design notes:
 *   - `dedupeKey` carries a UNIQUE index. MongoDB itself rejects a second
 *     insert with the same key (duplicate-key error 11000), so two concurrent
 *     enqueues cannot both create a job. The service treats 11000 as
 *     "already enqueued" and returns the existing job.
 *   - `status` + `nextAttemptAt` is the polling index; `status` +
 *     `processingLeaseUntil` is the stale-lease recovery index.
 *   - `suppressed` is deliberately distinct from `sent`: a suppressed job was
 *     intentionally not delivered (user preference or a permanent recipient
 *     condition) and must never be reported as delivered.
 *   - Rendered HTML is never stored. `templateId` + `templateData` are kept,
 *     and rendering happens at send time so a template fix applies to queued
 *     jobs and sensitive values are not persisted in rendered form.
 *   - No TTL index: retention has not been decided.
 *
 * Exactly-once limitation:
 *   SMTP provides no idempotency key for sends. If the provider accepts a
 *   message and the process crashes before `status: "sent"` is committed, the
 *   lease-recovery sweep will re-claim the job and send a second copy. This
 *   collection therefore guarantees at-most-once claiming and at-least-once
 *   delivery, but NOT exactly-once delivery across that window.
 */
const emailOutboxSchema = new mongoose.Schema(
    {
        /**
         * The user this email is addressed to, when known.
         * Null is permitted only for jobs with no resolvable user, which the
         * service treats as a permanent (dead) condition.
         */
        recipientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        /**
         * Destination address, captured at enqueue time.
         * Lowercased and trimmed by the service.
         */
        to: {
            type: String,
            required: [true, "Destination email is required"],
            trim: true,
            lowercase: true,
            maxlength: [254, "Destination email cannot exceed 254 characters"],
        },

        /**
         * Notification category. Drives preference enforcement at delivery
         * time and must be one of NOTIFICATION_CATEGORY.
         */
        category: {
            type: String,
            enum: {
                values: Object.values(NOTIFICATION_CATEGORY),
                message: "Invalid notification category",
            },
            required: [true, "Notification category is required"],
        },

        /**
         * Stable identifier of the template to render at send time.
         * Must be one of EMAIL_TEMPLATE_ID; the service maps it to the real
         * render function and its permitted payload keys.
         */
        templateId: {
            type: String,
            enum: {
                values: Object.values(EMAIL_TEMPLATE_ID),
                message: "Invalid email template ID",
            },
            required: [true, "Template ID is required"],
        },

        /**
         * Validated payload passed to the template render function.
         *
         * The service restricts this to a per-template allowlist of keys.
         * Consultant-recipient payment templates reject `amount` and payment
         * references structurally, enforcing the existing privacy rule.
         */
        templateData: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },

        /**
         * Job lifecycle state. See EMAIL_OUTBOX_STATUS for the full contract.
         */
        status: {
            type: String,
            enum: {
                values: Object.values(EMAIL_OUTBOX_STATUS),
                message: "Invalid email outbox status",
            },
            default: EMAIL_OUTBOX_STATUS.PENDING,
        },

        /**
         * Number of delivery attempts made so far. Incremented atomically by
         * the claim, so it is never reset by lease recovery.
         */
        attempts: {
            type: Number,
            default: 0,
            min: 0,
        },

        /**
         * Maximum attempts before the job is marked `dead`.
         */
        maxAttempts: {
            type: Number,
            default: 5,
            min: 1,
        },

        /**
         * Earliest time this job may be claimed. Advanced with exponential
         * backoff on each transient failure.
         */
        nextAttemptAt: {
            type: Date,
            default: Date.now,
        },

        /** Timestamp of the most recent delivery attempt. */
        lastAttemptAt: {
            type: Date,
            default: null,
        },

        /**
         * Crash-recovery lease. A `processing` job whose lease has expired is
         * eligible for re-claiming. Set when the job is claimed.
         */
        processingLeaseUntil: {
            type: Date,
            default: null,
        },

        /** Timestamp when the provider accepted the message. */
        sentAt: {
            type: Date,
            default: null,
        },

        /**
         * Sanitized error message from the most recent failure.
         * Only `error.message` is stored — never the payload, the rendered
         * body, the recipient address, or credentials.
         */
        lastError: {
            type: String,
            default: null,
            maxlength: [500, "Last error cannot exceed 500 characters"],
        },

        /**
         * Idempotency key. UNIQUE index makes duplicate enqueue impossible
         * even under concurrency.
         *
         * Recommended format (enforced by callers, not by this schema):
         *   `${templateId}:${recipientId}:${subjectId}`
         */
        dedupeKey: {
            type: String,
            required: [true, "Dedupe key is required"],
            trim: true,
            maxlength: [300, "Dedupe key cannot exceed 300 characters"],
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Idempotency: a second enqueue with the same dedupeKey is rejected by MongoDB.
emailOutboxSchema.index({ dedupeKey: 1 }, { unique: true });

// Worker polling: due pending jobs, oldest due first.
emailOutboxSchema.index({ status: 1, nextAttemptAt: 1 });

// Stale-lease recovery: processing jobs whose lease has expired.
emailOutboxSchema.index({ status: 1, processingLeaseUntil: 1 });

const EmailOutbox = mongoose.model("EmailOutbox", emailOutboxSchema);

export default EmailOutbox;
