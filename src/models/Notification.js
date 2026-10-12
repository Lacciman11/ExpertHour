import mongoose from "mongoose";

import { NOTIFICATION_CATEGORY } from "../utils/constants.js";

/**
 * Notification — persistent in-app notification record.
 *
 * Phase 0 scope: persistence only. This model stores the in-app notification
 * and its read state. Email delivery, outbox processing, preference
 * enforcement, and reminder scheduling are deliberately out of scope and are
 * implemented in later phases.
 *
 * Idempotency:
 *   `dedupeKey` carries a UNIQUE index. MongoDB itself rejects a second insert
 *   with the same key (duplicate-key error 11000), so two concurrent writers
 *   cannot both create a record. The notification service treats 11000 as
 *   "already created" rather than as an application failure. There is
 *   intentionally NO read-before-write check, because that pattern is racy.
 *
 * Recommended dedupeKey format (enforced by callers, not by this schema):
 *   `${type}:${recipientId}:${subjectId}`
 *   e.g. "booking.confirmed:64f...:64f..."
 *
 * Retention:
 *   No TTL index is defined. The retention period has not been decided yet;
 *   adding a TTL index is a follow-up change once that product decision lands.
 */
const notificationSchema = new mongoose.Schema(
    {
        /**
         * The user who receives this notification.
         * Always resolved from the authenticated request (req.user._id) by the
         * service layer — never accepted from caller-supplied input.
         */
        recipientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Recipient ID is required"],
        },

        /**
         * Stable notification category. Must be one of NOTIFICATION_CATEGORY.
         * Used for preference lookups and for grouping in the UI.
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
         * Stable event identifier, e.g. "booking.confirmed", "reminder.24h",
         * "payout.completed". Callers must use a consistent, dot-namespaced
         * value so that dedupe keys and analytics remain stable over time.
         */
        type: {
            type: String,
            required: [true, "Notification type is required"],
            trim: true,
            maxlength: [100, "Notification type cannot exceed 100 characters"],
        },

        /**
         * Short human-readable headline shown in the notification list.
         */
        title: {
            type: String,
            required: [true, "Notification title is required"],
            trim: true,
            maxlength: [200, "Notification title cannot exceed 200 characters"],
        },

        /**
         * Longer human-readable message body.
         */
        body: {
            type: String,
            required: [true, "Notification body is required"],
            trim: true,
            maxlength: [2000, "Notification body cannot exceed 2000 characters"],
        },

        /**
         * Safe, non-sensitive payload for deep linking and client rendering.
         *
         * The service layer restricts this to an explicit allowlist of keys
         * (see ALLOWED_DATA_KEYS in notification.service.js). It must never
         * contain payment amounts, card data, tokens, credentials, or
         * arbitrary external URLs.
         */
        data: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },

        /**
         * Timestamp when the recipient read this notification.
         * null means unread.
         */
        readAt: {
            type: Date,
            default: null,
        },

        /**
         * Idempotency key. UNIQUE index makes duplicate creation impossible
         * even under concurrency.
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

// Idempotency: a second insert with the same dedupeKey is rejected by MongoDB.
notificationSchema.index({ dedupeKey: 1 }, { unique: true });

// Recipient-based chronological listing (newest first).
notificationSchema.index({ recipientId: 1, createdAt: -1 });

// Unread-count queries.
notificationSchema.index({ recipientId: 1, readAt: 1 });

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
