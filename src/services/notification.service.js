import mongoose from "mongoose";

import Notification from "../models/Notification.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import {
    NOTIFICATION_CATEGORY,
    MANDATORY_EMAIL_CATEGORIES,
    MANDATORY_IN_APP_CATEGORIES,
} from "../utils/constants.js";

/**
 * NotificationService — Phase 0 persistence foundation.
 *
 * Creates in-app notification records idempotently.
 *
 * Scope boundaries (deliberate, per Phase 0):
 *   - Does NOT send email. Email delivery is a later phase.
 *   - Does NOT enforce preferences. Preference enforcement happens at delivery
 *     time; this service only persists records.
 *   - Does NOT mutate bookings, payments, refunds, sessions, earnings, or
 *     payouts. It only reads User existence to validate the recipient.
 *   - Does NOT expose routes. Route wiring is a later phase.
 *
 * Idempotency:
 *   The unique index on Notification.dedupeKey is the sole race-safe guard.
 *   A duplicate insert raises MongoDB duplicate-key error 11000, which this
 *   service treats as "already created" and returns the existing record.
 *   There is intentionally no read-before-write check: that pattern is racy
 *   and would allow two concurrent writers to both pass the check.
 */

// ---------------------------------------------------------------------------
// Allowed `data` keys
// ---------------------------------------------------------------------------

/**
 * The only keys permitted inside Notification.data.
 *
 * These are safe, non-sensitive object references plus a single deep-link
 * path. Anything else is dropped rather than stored, so a caller cannot
 * smuggle payment amounts, tokens, credentials, or arbitrary external URLs
 * into a notification payload.
 */
const ALLOWED_DATA_KEYS = Object.freeze([
    "bookingId",
    "paymentId",
    "sessionId",
    "earningId",
    "payoutId",
    "reviewId",
    "applicationId",
    "deepLinkPath",
]);

/**
 * Deep-link paths that already exist in the application.
 *
 * Sourced from experthour/src/config/navigation.ts (ROUTES) and
 * experthour/src/AppRoutes.tsx. Only these literal prefixes are accepted, so
 * a notification can never link to an arbitrary external URL.
 *
 * Dynamic segments are expressed with a leading ":" and are validated by the
 * caller-supplied id values, not by this list.
 */
const ALLOWED_DEEP_LINK_PREFIXES = Object.freeze([
    // Business Owner / client dashboard
    "/dashboard/client",
    "/dashboard/client/bookings",
    "/dashboard/client/bookings/:bookingId/review",
    // Consultant dashboard
    "/dashboard/consultant",
    "/dashboard/consultant/bookings",
    "/dashboard/consultant/earnings",
    "/dashboard/consultant/reviews",
    "/dashboard/consultant/availability",
    // Admin dashboard
    "/dashboard/admin",
    "/dashboard/admin/pending",
    "/dashboard/admin/payments",
    "/dashboard/admin/earnings",
    "/dashboard/admin/payouts",
    "/dashboard/admin/reports",
    // Shared
    "/profile",
    "/settings",
    "/find-experts",
    "/bookings/:bookingId/session",
]);

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const MAX_TYPE_LENGTH = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 2000;
const MAX_DEDUPE_KEY_LENGTH = 300;

/**
 * MongoDB duplicate-key error code. Raised when a unique index rejects an
 * insert — here, a second Notification with the same dedupeKey.
 */
const DUPLICATE_KEY_ERROR_CODE = 11000;

class NotificationService {

    /**
     * Strip `data` down to the allowlisted keys and validate the deep link.
     *
     * Unknown keys are dropped. A deepLinkPath that is not an allowed internal
     * path is dropped. Object-id-shaped values are normalised to ObjectId so
     * that references are stored consistently.
     *
     * @param {object} rawData - caller-supplied data object (may be undefined)
     * @returns {object} sanitised data object (possibly empty)
     * @private
     */
    _sanitizeData(rawData) {

        if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {

            return {};

        }

        const sanitized = {};

        for (const key of ALLOWED_DATA_KEYS) {

            if (!Object.prototype.hasOwnProperty.call(rawData, key)) {

                continue;

            }

            const value = rawData[key];

            if (value === undefined || value === null) {

                continue;

            }

            if (key === "deepLinkPath") {

                if (typeof value !== "string" || !this._isAllowedDeepLink(value)) {

                    continue;

                }

                sanitized.deepLinkPath = value;

                continue;

            }

            // Reference ids must be valid ObjectIds. Anything else is dropped
            // rather than stored as an arbitrary string.
            if (!mongoose.Types.ObjectId.isValid(value)) {

                continue;

            }

            sanitized[key] = new mongoose.Types.ObjectId(value);

        }

        return sanitized;

    }

    /**
     * True when `path` is one of the known internal deep-link paths.
     *
     * Accepts an exact match or a path that extends an allowed prefix with
     * additional safe segments (e.g. "/dashboard/client/bookings/<id>").
     * Rejects absolute URLs, protocol-relative URLs, and anything outside the
     * allowlist.
     *
     * @param {string} path
     * @returns {boolean}
     * @private
     */
    _isAllowedDeepLink(path) {

        if (typeof path !== "string" || path.length === 0) {

            return false;

        }

        // Reject anything that could escape the application origin.
        if (path.includes("://") || path.startsWith("//")) {

            return false;

        }

        // Must be an absolute application path.
        if (!path.startsWith("/")) {

            return false;

        }

        return ALLOWED_DEEP_LINK_PREFIXES.some((prefix) => {

            if (path === prefix) {

                return true;

            }

            // Allow the prefix to be extended by further path segments, e.g.
            // "/dashboard/client/bookings" + "/64f...".
            if (path.startsWith(prefix + "/")) {

                return true;

            }

            // Allow a dynamic prefix such as
            // "/dashboard/client/bookings/:bookingId/review" to match a
            // concrete path like "/dashboard/client/bookings/64f.../review".
            if (prefix.includes(":")) {

                const pattern = new RegExp(
                    "^" + prefix.replace(/:[^/]+/g, "[^/]+") + "$"
                );

                return pattern.test(path);

            }

            return false;

        });

    }

    /**
     * Validate and normalise caller input.
     *
     * @param {object} input
     * @returns {object} normalised input
     * @throws {ApiError} 400 on any validation failure
     * @private
     */
    _validateInput(input) {

        if (!input || typeof input !== "object") {

            throw new ApiError(400, "Notification input is required");

        }

        const { recipientId, category, type, title, body, dedupeKey, data } = input;

        // --- recipientId -----------------------------------------------------
        if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {

            throw new ApiError(400, "A valid recipientId is required");

        }

        // --- category --------------------------------------------------------
        if (!category || !Object.values(NOTIFICATION_CATEGORY).includes(category)) {

            throw new ApiError(400, "A valid notification category is required");

        }

        // --- type ------------------------------------------------------------
        if (typeof type !== "string" || type.trim().length === 0) {

            throw new ApiError(400, "Notification type is required");

        }

        if (type.trim().length > MAX_TYPE_LENGTH) {

            throw new ApiError(400, `Notification type cannot exceed ${MAX_TYPE_LENGTH} characters`);

        }

        // --- title -----------------------------------------------------------
        if (typeof title !== "string" || title.trim().length === 0) {

            throw new ApiError(400, "Notification title is required");

        }

        if (title.trim().length > MAX_TITLE_LENGTH) {

            throw new ApiError(400, `Notification title cannot exceed ${MAX_TITLE_LENGTH} characters`);

        }

        // --- body ------------------------------------------------------------
        if (typeof body !== "string" || body.trim().length === 0) {

            throw new ApiError(400, "Notification body is required");

        }

        if (body.trim().length > MAX_BODY_LENGTH) {

            throw new ApiError(400, `Notification body cannot exceed ${MAX_BODY_LENGTH} characters`);

        }

        // --- dedupeKey -------------------------------------------------------
        if (typeof dedupeKey !== "string" || dedupeKey.trim().length === 0) {

            throw new ApiError(400, "Notification dedupeKey is required");

        }

        if (dedupeKey.trim().length > MAX_DEDUPE_KEY_LENGTH) {

            throw new ApiError(400, `Notification dedupeKey cannot exceed ${MAX_DEDUPE_KEY_LENGTH} characters`);

        }

        return {
            recipientId: new mongoose.Types.ObjectId(recipientId),
            category,
            type: type.trim(),
            title: title.trim(),
            body: body.trim(),
            dedupeKey: dedupeKey.trim(),
            data: this._sanitizeData(data),
        };

    }

    /**
     * Create an in-app notification idempotently.
     *
     * Duplicate dedupeKey values are not an error: the existing record is
     * returned and `created` is false. This makes the function safe to call
     * from retries, webhook replays, and reminder workers.
     *
     * @param {object} input
     * @param {string} input.recipientId - User id (must exist)
     * @param {string} input.category - one of NOTIFICATION_CATEGORY
     * @param {string} input.type - stable event identifier
     * @param {string} input.title - headline
     * @param {string} input.body - message body
     * @param {string} input.dedupeKey - idempotency key
     * @param {object} [input.data] - safe references / deep link
     * @returns {Promise<{notification: object, created: boolean}>}
     * @throws {ApiError} 400 on invalid input, 404 if the recipient does not exist
     */
    async create(input) {

        const normalised = this._validateInput(input);

        // Confirm the recipient exists. This is a read, not a mutation, and it
        // does not participate in any domain transaction.
        const recipient = await User.exists({ _id: normalised.recipientId });

        if (!recipient) {

            throw new ApiError(404, "Notification recipient not found");

        }

        try {

            const notification = await Notification.create(normalised);

            return { notification, created: true };

        } catch (error) {

            // A duplicate dedupeKey means the notification already exists.
            // This is the expected outcome for a retry or a replayed event,
            // not an application failure.
            if (error && error.code === DUPLICATE_KEY_ERROR_CODE) {

                const existing = await Notification.findOne({ dedupeKey: normalised.dedupeKey });

                return { notification: existing, created: false };

            }

            throw error;

        }

    }

    /**
     * List a recipient's notifications, newest first.
     * recipientId is always scoped inside the database query.
     */
    async listForRecipient(recipientId, options = {}) {

        const ownerId = this._requireObjectId(recipientId, "recipientId");

        const page = Math.max(1, parseInt(options.page, 10) || 1);
        const requestedLimit = parseInt(options.limit, 10) || DEFAULT_PAGE_SIZE;
        const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, requestedLimit));
        const skip = (page - 1) * limit;

        const query = { recipientId: ownerId };

        if (options.unreadOnly === true) {
            query.readAt = null;
        }

        const [notifications, total] = await Promise.all([
            Notification.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
            Notification.countDocuments(query),
        ]);

        return {
            notifications,
            total,
            page,
            limit,
            totalPages: total > 0 ? Math.ceil(total / limit) : 0,
        };

    }

    /**
     * Count a recipient's unread notifications.
     */
    async countUnread(recipientId) {

        const ownerId = this._requireObjectId(recipientId, "recipientId");

        return Notification.countDocuments({ recipientId: ownerId, readAt: null });

    }

    /**
     * Mark one notification as read, scoped to its owner.
     *
     * The filter includes BOTH the notification id and the authenticated
     * recipientId, so another user's notification is indistinguishable from a
     * non-existent one. Idempotent: readAt is only set when currently null.
     */
    async markAsRead(recipientId, notificationId) {

        const ownerId = this._requireObjectId(recipientId, "recipientId");
        const targetId = this._requireObjectId(notificationId, "notificationId");

        // Atomic transition: only an unread notification is updated, so two
        // concurrent first-calls cannot both write a different readAt.
        const updated = await Notification.findOneAndUpdate(
            { _id: targetId, recipientId: ownerId, readAt: null },
            { $set: { readAt: new Date() } },
            { new: true }
        );

        if (updated) {

            return updated;

        }

        // No unread document matched. Either it is already read (idempotent
        // repeat — return it unchanged) or it does not exist / belongs to
        // another user (return null so the caller reports 404).
        return Notification.findOne({ _id: targetId, recipientId: ownerId });

    }

    /**
     * Mark every unread notification belonging to the recipient as read.
     * Scoped strictly by recipientId.
     */
    async markAllAsRead(recipientId) {

        const ownerId = this._requireObjectId(recipientId, "recipientId");

        const result = await Notification.updateMany(
            { recipientId: ownerId, readAt: null },
            { $set: { readAt: new Date() } }
        );

        return { modifiedCount: result.modifiedCount || 0 };

    }

    /**
     * List an admin's own notifications in the `admin` category.
     *
     * Visibility policy: an admin sees only notifications addressed to them
     * (recipientId === the authenticated admin) whose category is `admin`.
     * This does not expose other users' notifications and does not invent a
     * fan-out rule; who receives an admin notification is decided at creation
     * time, which is out of scope for this phase.
     */
    async listAdminNotifications(adminId, options = {}) {

        const ownerId = this._requireObjectId(adminId, "recipientId");

        const page = Math.max(1, parseInt(options.page, 10) || 1);
        const requestedLimit = parseInt(options.limit, 10) || DEFAULT_PAGE_SIZE;
        const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, requestedLimit));
        const skip = (page - 1) * limit;

        const query = {
            recipientId: ownerId,
            category: NOTIFICATION_CATEGORY.ADMIN,
        };

        const [notifications, total] = await Promise.all([
            Notification.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
            Notification.countDocuments(query),
        ]);

        return {
            notifications,
            total,
            page,
            limit,
            totalPages: total > 0 ? Math.ceil(total / limit) : 0,
        };

    }

    /**
     * Validate and coerce an id to an ObjectId.
     */
    _requireObjectId(value, fieldName) {

        if (!value || !mongoose.Types.ObjectId.isValid(value)) {

            throw new ApiError(400, `A valid ${fieldName} is required`);

        }

        return new mongoose.Types.ObjectId(value);

    }

    /**
     * Build a dedupe key from its parts.
     *
     * Centralised so every caller produces the same shape:
     *   `${type}:${recipientId}:${subjectId}`
     *
     * @param {string} type - stable event identifier
     * @param {string} recipientId - User id
     * @param {string} subjectId - id of the entity the event is about
     * @returns {string}
     */
    buildDedupeKey(type, recipientId, subjectId) {

        if (typeof type !== "string" || type.trim().length === 0) {

            throw new ApiError(400, "Notification type is required to build a dedupe key");

        }

        if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {

            throw new ApiError(400, "A valid recipientId is required to build a dedupe key");

        }

        if (!subjectId || typeof subjectId !== "string" || subjectId.trim().length === 0) {

            throw new ApiError(400, "A subjectId is required to build a dedupe key");

        }

        return `${type.trim()}:${recipientId}:${subjectId.trim()}`;

    }

    // -----------------------------------------------------------------------
    // Preferences (Phase 1)
    // -----------------------------------------------------------------------

    /**
     * Resolve a user's effective notification preferences.
     *
     * Reads the stored document. Because every preference field carries a
     * schema default, a legacy user whose document predates Phase 0 and has no
     * explicitly stored preferences still resolves to the intended defaults
     * when Mongoose hydrates the document.
     *
     * Mandatory channels are forced to `true` in the returned value so the
     * response always represents the effective preference, regardless of what
     * is stored.
     *
     * @param {object} user - a Mongoose User document
     * @returns {{booking: {inApp: boolean, email: boolean}, ...}}
     */
    getEffectivePreferences(user) {

        if (!user) {

            throw new ApiError(400, "A user document is required");

        }

        const stored = user.notificationPreferences || {};
        const effective = {};

        for (const category of Object.values(NOTIFICATION_CATEGORY)) {

            const storedCategory = stored[category] || {};

            const inApp = storedCategory.inApp === true;
            const email = storedCategory.email === true;

            effective[category] = {
                inApp: MANDATORY_IN_APP_CATEGORIES.includes(category) ? true : inApp,
                email: MANDATORY_EMAIL_CATEGORIES.includes(category) ? true : email,
            };

        }

        return effective;

    }

    /**
     * Validate a partial preference update.
     *
     * Accepts only the ten supported categories and the two supported
     * channels. Rejects unknown categories, unknown channel names, malformed
     * objects, and non-boolean values.
     *
     * Mandatory channels are NORMALISED to `true` rather than rejected: a
     * request that tries to disable a mandatory channel is accepted but the
     * stored value is forced to enabled. This keeps partial updates simple
     * and avoids leaking which categories are mandatory through error
     * messages, while still guaranteeing the effective preference is enabled.
     *
     * @param {object} updates - request body
     * @returns {object} sanitised updates keyed by category then channel
     * @throws {ApiError} 400 on any malformed input
     */
    validatePreferenceUpdates(updates) {

        if (!updates || typeof updates !== "object" || Array.isArray(updates)) {

            throw new ApiError(400, "Preferences must be an object");

        }

        const sanitised = {};

        for (const category of Object.keys(updates)) {

            if (!Object.values(NOTIFICATION_CATEGORY).includes(category)) {

                throw new ApiError(400, `Unknown notification category: ${category}`);

            }

            const channels = updates[category];

            if (!channels || typeof channels !== "object" || Array.isArray(channels)) {

                throw new ApiError(400, `Preferences for "${category}" must be an object`);

            }

            sanitised[category] = {};

            for (const channel of Object.keys(channels)) {

                if (channel !== "inApp" && channel !== "email") {

                    throw new ApiError(400, `Unknown notification channel: ${channel}`);

                }

                const value = channels[channel];

                if (typeof value !== "boolean") {

                    throw new ApiError(400, `Preference "${category}.${channel}" must be a boolean`);

                }

                // Normalise mandatory channels to enabled.
                const isMandatory = channel === "inApp"
                    ? MANDATORY_IN_APP_CATEGORIES.includes(category)
                    : MANDATORY_EMAIL_CATEGORIES.includes(category);

                sanitised[category][channel] = isMandatory ? true : value;

            }

        }

        return sanitised;

    }

    /**
     * Apply a validated partial preference update to a user and persist it.
     *
     * Only the supplied categories and channels are written; omitted values
     * retain their existing effective values. Mandatory channels are forced
     * to enabled.
     *
     * @param {object} user - a Mongoose User document
     * @param {object} updates - request body (validated by validatePreferenceUpdates)
     * @returns {Promise<object>} the user's effective preferences after the update
     */
    async updatePreferences(user, updates) {

        if (!user) {

            throw new ApiError(400, "A user document is required");

        }

        const sanitised = this.validatePreferenceUpdates(updates);

        // Ensure the nested path exists on the document before assigning.
        if (!user.notificationPreferences) {

            user.notificationPreferences = {};

        }

        for (const category of Object.keys(sanitised)) {

            if (!user.notificationPreferences[category]) {

                user.notificationPreferences[category] = {};

            }

            for (const channel of Object.keys(sanitised[category])) {

                user.notificationPreferences[category][channel] = sanitised[category][channel];

            }

        }

        await user.save();

        return this.getEffectivePreferences(user);

    }

}

export default new NotificationService();
