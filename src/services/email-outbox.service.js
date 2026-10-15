import mongoose from "mongoose";

import EmailOutbox from "../models/EmailOutbox.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import {
    EMAIL_OUTBOX_STATUS,
    EMAIL_TEMPLATE_ID,
    MANDATORY_EMAIL_CATEGORIES,
    NOTIFICATION_CATEGORY,
} from "../utils/constants.js";
import {
    emailService,
    forgotPasswordTemplate,
    paymentFailureConsultantTemplate,
    paymentFailureTemplate,
    paymentSuccessConsultantTemplate,
    paymentSuccessTemplate,
    verifyEmailTemplate,
} from "./email/index.js";
// Namespace import for the consultant decision templates. Existing test suites
// mock "./email/index.js" with only the original templates; a namespace import
// resolves a missing export to `undefined` (no link error) instead of breaking
// those suites, while the real module provides both renderers in production.
import * as emailTemplates from "./email/index.js";
import notificationService from "./notification.service.js";

/**
 * EmailOutboxService — durable, retryable email delivery.
 *
 * Phase 3A scope: persistence and state transitions. The background worker
 * that polls this service is a later step, and no existing email call site
 * writes here yet.
 *
 * Concurrency model:
 *   Every state transition is a guarded `findOneAndUpdate` whose filter
 *   includes the state the caller believes it is acting on. A stale worker
 *   therefore matches nothing and cannot overwrite newer state — the same
 *   pattern used by consultation-session-outcome.service.js.
 *
 * Exactly-once limitation:
 *   SMTP provides no idempotency key. If the provider accepts a message and
 *   the process crashes before `status: "sent"` is committed, lease recovery
 *   re-claims the job and a second copy is sent. This service guarantees
 *   at-most-once claiming and at-least-once delivery, not exactly-once.
 */

// ---------------------------------------------------------------------------
// Bounded configuration defaults
// ---------------------------------------------------------------------------

// Safe, bounded defaults. The worker overrides these via `configure()` so the
// effective values come from a single source (env.emailOutbox) rather than
// being duplicated as conflicting hardcoded numbers.
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_LEASE_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_BASE_DELAY_MS = 30 * 1000; // 30 seconds
const DEFAULT_MAX_DELAY_MS = 60 * 60 * 1000; // 1 hour
const MAX_LAST_ERROR_LENGTH = 500;

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY_ERROR_CODE = 11000;

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

/**
 * Explicit allowlist mapping each supported template id to its render
 * function and the payload keys it accepts.
 *
 * Keys are derived from the actual template signatures in
 * src/services/email/templates/. A caller can never supply an arbitrary
 * function name or raw HTML.
 *
 * `forbiddenKeys` enforces the consultant payment-email privacy rule
 * structurally: consultant-recipient payment templates reject `amount` and
 * payment references, so a caller cannot leak the client's financial data
 * even by mistake.
 */
const TEMPLATE_REGISTRY = Object.freeze({
    [EMAIL_TEMPLATE_ID.VERIFY_EMAIL]: {
        render: verifyEmailTemplate,
        allowedKeys: ["firstName", "verificationUrl"],
        forbiddenKeys: [],
    },
    [EMAIL_TEMPLATE_ID.FORGOT_PASSWORD]: {
        render: forgotPasswordTemplate,
        allowedKeys: ["firstName", "resetUrl"],
        forbiddenKeys: [],
    },
    [EMAIL_TEMPLATE_ID.PAYMENT_SUCCESS]: {
        render: paymentSuccessTemplate,
        allowedKeys: [
            "clientName",
            "consultantName",
            "amount",
            "date",
            "time",
            "duration",
            "meetingLink",
            "reference",
        ],
        forbiddenKeys: [],
    },
    [EMAIL_TEMPLATE_ID.PAYMENT_FAILURE]: {
        render: paymentFailureTemplate,
        allowedKeys: [
            "clientName",
            "consultantName",
            "amount",
            "date",
            "time",
            "reference",
            "reason",
        ],
        forbiddenKeys: [],
    },
    // Consultant-recipient payment templates: no amount, no payment reference.
    [EMAIL_TEMPLATE_ID.PAYMENT_SUCCESS_CONSULTANT]: {
        render: paymentSuccessConsultantTemplate,
        allowedKeys: [
            "consultantName",
            "clientName",
            "date",
            "time",
            "duration",
            "meetingLink",
        ],
        forbiddenKeys: ["amount", "reference"],
    },
    [EMAIL_TEMPLATE_ID.PAYMENT_FAILURE_CONSULTANT]: {
        render: paymentFailureConsultantTemplate,
        allowedKeys: ["consultantName", "clientName", "date", "time", "reason"],
        forbiddenKeys: ["amount", "reference"],
    },

    [EMAIL_TEMPLATE_ID.CONSULTANT_APPROVAL]: {
        render: emailTemplates.consultantApprovalTemplate,
        allowedKeys: ["firstName"],
        forbiddenKeys: [],
    },

    [EMAIL_TEMPLATE_ID.CONSULTANT_REJECTION]: {
        render: emailTemplates.consultantRejectionTemplate,
        allowedKeys: ["firstName"],
        forbiddenKeys: [],
    },

    [EMAIL_TEMPLATE_ID.BOOKING_CANCELLED]: {
        render: emailTemplates.bookingCancelledTemplate,
        allowedKeys: ["firstName"],
        forbiddenKeys: [],
    },

    [EMAIL_TEMPLATE_ID.BOOKING_DECLINED]: {
        render: emailTemplates.bookingDeclinedTemplate,
        allowedKeys: ["firstName"],
        forbiddenKeys: [],
    },

    [EMAIL_TEMPLATE_ID.REFUND_COMPLETED]: {
        render: emailTemplates.refundCompletedTemplate,
        allowedKeys: ["firstName"],
        forbiddenKeys: [],
    },

    [EMAIL_TEMPLATE_ID.REFUND_FAILED]: {
        render: emailTemplates.refundFailedTemplate,
        allowedKeys: ["firstName"],
        forbiddenKeys: [],
    },

    [EMAIL_TEMPLATE_ID.PAYOUT_COMPLETED]: {
        render: emailTemplates.payoutCompletedTemplate,
        allowedKeys: ["firstName"],
        forbiddenKeys: [],
    },

    [EMAIL_TEMPLATE_ID.PAYOUT_FAILED]: {
        render: emailTemplates.payoutFailedTemplate,
        allowedKeys: ["firstName"],
        forbiddenKeys: [],
    },

    [EMAIL_TEMPLATE_ID.SESSION_COMPLETED]: {
        render: emailTemplates.sessionCompletedTemplate,
        allowedKeys: ["firstName"],
        forbiddenKeys: [],
    },

    [EMAIL_TEMPLATE_ID.REVIEW_RECEIVED]: {
        render: emailTemplates.reviewReceivedTemplate,
        allowedKeys: ["firstName"],
        forbiddenKeys: [],
    },

    [EMAIL_TEMPLATE_ID.EARNING_CANCELLED]: {
        render: emailTemplates.earningCancelledTemplate,
        allowedKeys: ["firstName"],
        forbiddenKeys: [],
    },

    // Booking reminders: one shared renderer, two IDs so the 24-hour and
    // 1-hour reminders get distinct dedupe keys.
    [EMAIL_TEMPLATE_ID.BOOKING_REMINDER_24H]: {
        render: emailTemplates.bookingReminderTemplate,
        allowedKeys: ["firstName", "reminderLabel"],
        forbiddenKeys: [],
    },

    [EMAIL_TEMPLATE_ID.BOOKING_REMINDER_1H]: {
        render: emailTemplates.bookingReminderTemplate,
        allowedKeys: ["firstName", "reminderLabel"],
        forbiddenKeys: [],
    },

    // Review request: client-facing, no consultant identity, no rating, no
    // review text, no financial data.
    [EMAIL_TEMPLATE_ID.REVIEW_REQUEST]: {
        render: emailTemplates.reviewRequestTemplate,
        allowedKeys: ["firstName"],
        forbiddenKeys: [],
    },
});

/** Payload keys that must never appear in any template payload. */
const GLOBALLY_FORBIDDEN_KEYS = Object.freeze([
    "password",
    "accessToken",
    "refreshToken",
    "token",
    "client_secret",
    "clientSecret",
    "authorization",
]);

const MAX_TEMPLATE_VALUE_LENGTH = 500;

class EmailOutboxService {

    constructor() {

        // Effective configuration. Overridden by `configure()` so the worker
        // and the service always agree on retry and lease behaviour.
        this.config = {
            maxAttempts: DEFAULT_MAX_ATTEMPTS,
            leaseMs: DEFAULT_LEASE_MS,
            baseDelayMs: DEFAULT_BASE_DELAY_MS,
            maxDelayMs: DEFAULT_MAX_DELAY_MS,
        };

    }

    /**
     * Apply worker configuration.
     *
     * Called once at startup with `env.emailOutbox` so the service and the
     * worker share a single source of truth instead of conflicting hardcoded
     * values. Unknown or invalid entries are ignored, leaving the safe
     * default in place.
     *
     * @param {object} [settings]
     * @param {number} [settings.maxAttempts]
     * @param {number} [settings.leaseMs]
     * @param {number} [settings.baseDelayMs]
     * @param {number} [settings.maxDelayMs]
     */
    configure(settings = {}) {

        if (!settings || typeof settings !== "object") {

            return this.config;

        }

        const assign = (key, min, max) => {

            const value = Number(settings[key]);

            if (Number.isFinite(value) && value >= min && value <= max) {

                this.config[key] = Math.floor(value);

            }

        };

        assign("maxAttempts", 1, 20);
        assign("leaseMs", 10_000, 3_600_000);
        assign("baseDelayMs", 1_000, 3_600_000);
        assign("maxDelayMs", 1_000, 86_400_000);

        // The backoff cap must never be below the base delay, otherwise every
        // retry would be clamped to a value smaller than the first delay.
        if (this.config.maxDelayMs < this.config.baseDelayMs) {

            this.config.maxDelayMs = this.config.baseDelayMs;

        }

        return this.config;

    }

    // -----------------------------------------------------------------------
    // Validation helpers
    // -----------------------------------------------------------------------

    /**
     * Validate and normalise an email address.
     * @returns {string} the trimmed, lowercased address
     * @throws {ApiError} 400 when missing or malformed
     * @private
     */
    _validateEmail(value) {

        if (typeof value !== "string" || value.trim().length === 0) {

            throw new ApiError(400, "A destination email is required");

        }

        const normalised = value.trim().toLowerCase();

        if (normalised.length > 254) {

            throw new ApiError(400, "Destination email cannot exceed 254 characters");

        }

        // Deliberately permissive: the SMTP provider is the final authority on
        // deliverability. This only rejects obviously malformed input.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {

            throw new ApiError(400, "Destination email is malformed");

        }

        return normalised;

    }

    /**
     * Validate a template id against the registry.
     * @private
     */
    _requireTemplate(templateId) {

        if (typeof templateId !== "string" || !TEMPLATE_REGISTRY[templateId]) {

            throw new ApiError(400, "Unsupported email template ID");

        }

        return TEMPLATE_REGISTRY[templateId];

    }

    /**
     * Validate a template payload against the registry allowlist.
     *
     * Rejects unknown keys, globally forbidden keys, per-template forbidden
     * keys, non-string values, and over-long values. Returns a new object
     * containing only the permitted keys.
     *
     * @private
     */
    _validateTemplateData(templateId, templateData) {

        const template = this._requireTemplate(templateId);

        if (
            templateData === undefined ||
            templateData === null ||
            (typeof templateData === "object" && Object.keys(templateData).length === 0)
        ) {

            // An empty payload is allowed; templates render with undefined
            // values for anything omitted.
            return {};

        }

        if (typeof templateData !== "object" || Array.isArray(templateData)) {

            throw new ApiError(400, "Template data must be an object");

        }

        const sanitised = {};

        for (const key of Object.keys(templateData)) {

            if (GLOBALLY_FORBIDDEN_KEYS.includes(key)) {

                throw new ApiError(400, `Template data key "${key}" is not permitted`);

            }

            if (template.forbiddenKeys.includes(key)) {

                throw new ApiError(
                    400,
                    `Template data key "${key}" is not permitted for template "${templateId}"`
                );

            }

            if (!template.allowedKeys.includes(key)) {

                throw new ApiError(
                    400,
                    `Template data key "${key}" is not permitted for template "${templateId}"`
                );

            }

            const value = templateData[key];

            if (value === undefined || value === null) {

                continue;

            }

            if (typeof value !== "string" && typeof value !== "number") {

                throw new ApiError(400, `Template data key "${key}" must be a string or number`);

            }

            if (String(value).length > MAX_TEMPLATE_VALUE_LENGTH) {

                throw new ApiError(
                    400,
                    `Template data key "${key}" cannot exceed ${MAX_TEMPLATE_VALUE_LENGTH} characters`
                );

            }

            sanitised[key] = value;

        }

        return sanitised;

    }

    /**
     * Truncate an error to a safe, storable message.
     * Only `error.message` is ever kept — never the payload or rendered body.
     * @private
     */
    _sanitizeError(error) {

        const message = error && error.message ? String(error.message) : "Unknown error";

        return message.slice(0, MAX_LAST_ERROR_LENGTH);

    }

    /**
     * Compute the next attempt time using bounded exponential backoff.
     * @param {number} attempts - attempts already made
     * @returns {Date}
     * @private
     */
    _computeNextAttemptAt(attempts) {

        const exponential = this.config.baseDelayMs * Math.pow(2, Math.max(0, attempts - 1));
        const delay = Math.min(exponential, this.config.maxDelayMs);

        return new Date(Date.now() + delay);

    }

    // -----------------------------------------------------------------------
    // Enqueue
    // -----------------------------------------------------------------------

    /**
     * Validate and enqueue a pending email job.
     *
     * Idempotent: a duplicate `dedupeKey` (MongoDB error 11000) returns the
     * existing job with `created: false` rather than failing.
     *
     * @param {object} input
     * @param {string} [input.recipientId] - User id, when known
     * @param {string} input.to - destination email
     * @param {string} input.category - NOTIFICATION_CATEGORY value
     * @param {string} input.templateId - EMAIL_TEMPLATE_ID value
     * @param {object} [input.templateData] - validated payload
     * @param {string} input.dedupeKey - idempotency key
     * @param {number} [input.maxAttempts] - retry limit
     * @returns {Promise<{job: object, created: boolean}>}
     */
    async enqueue(input) {

        if (!input || typeof input !== "object") {

            throw new ApiError(400, "Enqueue input is required");

        }

        const { recipientId, to, category, templateId, templateData, dedupeKey, maxAttempts } = input;

        // --- recipientId (optional but must be valid when supplied) ---------
        let normalisedRecipientId = null;

        if (recipientId !== undefined && recipientId !== null) {

            if (!mongoose.Types.ObjectId.isValid(recipientId)) {

                throw new ApiError(400, "A valid recipientId is required");

            }

            normalisedRecipientId = new mongoose.Types.ObjectId(recipientId);

        }

        // --- destination ----------------------------------------------------
        const normalisedTo = this._validateEmail(to);

        // --- category -------------------------------------------------------
        if (!category || !Object.values(NOTIFICATION_CATEGORY).includes(category)) {

            throw new ApiError(400, "A valid notification category is required");

        }

        // --- template + payload --------------------------------------------
        // Validated here and again before sending, so a payload that was
        // valid at enqueue time is re-checked against the current registry.
        this._requireTemplate(templateId);
        const normalisedTemplateData = this._validateTemplateData(templateId, templateData);

        // --- dedupeKey ------------------------------------------------------
        if (typeof dedupeKey !== "string" || dedupeKey.trim().length === 0) {

            throw new ApiError(400, "A dedupeKey is required");

        }

        if (dedupeKey.trim().length > 300) {

            throw new ApiError(400, "dedupeKey cannot exceed 300 characters");

        }

        const normalisedMaxAttempts =
            Number.isInteger(maxAttempts) && maxAttempts >= 1
                ? maxAttempts
                : this.config.maxAttempts;

        const job = {
            recipientId: normalisedRecipientId,
            to: normalisedTo,
            category,
            templateId,
            templateData: normalisedTemplateData,
            dedupeKey: dedupeKey.trim(),
            maxAttempts: normalisedMaxAttempts,
            status: EMAIL_OUTBOX_STATUS.PENDING,
            attempts: 0,
            nextAttemptAt: new Date(),
        };

        try {

            const created = await EmailOutbox.create(job);

            return { job: created, created: true };

        } catch (error) {

            if (error && error.code === DUPLICATE_KEY_ERROR_CODE) {

                const existing = await EmailOutbox.findOne({ dedupeKey: job.dedupeKey });

                return { job: existing, created: false };

            }

            throw error;

        }

    }

    // -----------------------------------------------------------------------
    // Claim
    // -----------------------------------------------------------------------

    /**
     * Atomically claim one due pending job.
     *
     * The filter requires `status: "pending"` AND `nextAttemptAt <= now`, so
     * two concurrent claimers cannot both win: the loser's update matches
     * nothing and returns null. `attempts` is incremented atomically as part
     * of the same update.
     *
     * @param {object} [options]
     * @param {number} [options.leaseMs] - lease duration
     * @returns {Promise<object|null>} the claimed job, or null when none is due
     */
    async claimNextPendingJob(options = {}) {

        const leaseMs =
            Number.isFinite(options.leaseMs) && options.leaseMs > 0
                ? options.leaseMs
                : this.config.leaseMs;

        const now = new Date();
        const leaseUntil = new Date(now.getTime() + leaseMs);

        return EmailOutbox.findOneAndUpdate(
            {
                status: EMAIL_OUTBOX_STATUS.PENDING,
                nextAttemptAt: { $lte: now },
            },
            {
                $set: {
                    status: EMAIL_OUTBOX_STATUS.PROCESSING,
                    lastAttemptAt: now,
                    processingLeaseUntil: leaseUntil,
                },
                $inc: { attempts: 1 },
            },
            { new: true, sort: { nextAttemptAt: 1 } }
        );

    }

    // -----------------------------------------------------------------------
    // Terminal transitions
    // -----------------------------------------------------------------------

    /**
     * Mark a claimed job as successfully delivered.
     *
     * Guarded on `status: "processing"` so a stale worker cannot mark a job
     * that has already moved on.
     *
     * @returns {Promise<object|null>} the updated job, or null if not claimable
     */
    async markAsSent(jobId) {

        if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {

            throw new ApiError(400, "A valid job id is required");

        }

        return EmailOutbox.findOneAndUpdate(
            {
                _id: new mongoose.Types.ObjectId(jobId),
                status: EMAIL_OUTBOX_STATUS.PROCESSING,
            },
            {
                $set: {
                    status: EMAIL_OUTBOX_STATUS.SENT,
                    sentAt: new Date(),
                    processingLeaseUntil: null,
                    lastError: null,
                },
            },
            { new: true }
        );

    }

    /**
     * Mark a claimed job as intentionally not delivered.
     *
     * Used when a non-mandatory category is disabled by the user's effective
     * email preference, or when the recipient is permanently undeliverable.
     * `suppressed` is deliberately distinct from `sent` so a skipped email is
     * never reported as delivered.
     *
     * @param {string} jobId
     * @param {string} reason - sanitized, human-readable reason
     * @returns {Promise<object|null>}
     */
    async markAsSuppressed(jobId, reason) {

        if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {

            throw new ApiError(400, "A valid job id is required");

        }

        return EmailOutbox.findOneAndUpdate(
            {
                _id: new mongoose.Types.ObjectId(jobId),
                status: EMAIL_OUTBOX_STATUS.PROCESSING,
            },
            {
                $set: {
                    status: EMAIL_OUTBOX_STATUS.SUPPRESSED,
                    processingLeaseUntil: null,
                    lastError: this._sanitizeError({ message: reason }),
                },
            },
            { new: true }
        );

    }

    /**
     * Mark a claimed job as permanently failed.
     *
     * Used for permanent conditions that retrying cannot fix: an invalid
     * payload, an unknown template, or a recipient that does not exist.
     *
     * @returns {Promise<object|null>}
     */
    async markAsDead(jobId, error) {

        if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {

            throw new ApiError(400, "A valid job id is required");

        }

        return EmailOutbox.findOneAndUpdate(
            {
                _id: new mongoose.Types.ObjectId(jobId),
                status: EMAIL_OUTBOX_STATUS.PROCESSING,
            },
            {
                $set: {
                    status: EMAIL_OUTBOX_STATUS.DEAD,
                    processingLeaseUntil: null,
                    lastError: this._sanitizeError(error),
                },
            },
            { new: true }
        );

    }

    /**
     * Record a transient delivery failure and schedule a retry.
     *
     * When the attempt limit is reached the job is marked `dead` instead of
     * being rescheduled, so a permanently failing job cannot retry forever.
     *
     * @param {string} jobId
     * @param {Error|string} error - only `error.message` is stored
     * @returns {Promise<{job: object|null, retried: boolean}>}
     */
    async recordFailureAndScheduleRetry(jobId, error) {

        if (!jobId || !mongoose.Types.ObjectId.isValid(jobId)) {

            throw new ApiError(400, "A valid job id is required");

        }

        const job = await EmailOutbox.findById(jobId);

        if (!job) {

            throw new ApiError(404, "Email outbox job not found");

        }

        const sanitizedError = this._sanitizeError(error);

        // Retry limit reached → dead-letter.
        if (job.attempts >= job.maxAttempts) {

            const dead = await EmailOutbox.findOneAndUpdate(
                {
                    _id: job._id,
                    status: EMAIL_OUTBOX_STATUS.PROCESSING,
                },
                {
                    $set: {
                        status: EMAIL_OUTBOX_STATUS.DEAD,
                        processingLeaseUntil: null,
                        lastError: sanitizedError,
                    },
                },
                { new: true }
            );

            return { job: dead, retried: false };

        }

        const nextAttemptAt = this._computeNextAttemptAt(job.attempts);

        const retried = await EmailOutbox.findOneAndUpdate(
            {
                _id: job._id,
                status: EMAIL_OUTBOX_STATUS.PROCESSING,
            },
            {
                $set: {
                    status: EMAIL_OUTBOX_STATUS.PENDING,
                    nextAttemptAt,
                    processingLeaseUntil: null,
                    lastError: sanitizedError,
                },
            },
            { new: true }
        );

        // `retried` is null when the job is no longer in `processing`, i.e. a
        // stale worker attempted the transition. Report that honestly.
        return { job: retried, retried: retried !== null };

    }

    // -----------------------------------------------------------------------
    // Lease recovery
    // -----------------------------------------------------------------------

    /**
     * Recover jobs whose processing lease has expired.
     *
     * Only `processing` jobs with an expired lease are touched. The attempt
     * count is deliberately NOT reset, so a job that keeps crashing the worker
     * still reaches its retry limit.
     *
     * Terminal guard: a job whose `attempts` has already reached `maxAttempts`
     * is marked `dead` rather than returned to `pending`. Without this, a job
     * that repeatedly crashes the worker AFTER a successful send (i.e. before
     * `markAsSent` commits) would be recovered forever, because the
     * dead-letter check lives in `recordFailureAndScheduleRetry`, which is
     * never reached when the crash happens after the send succeeded.
     *
     * @param {object} [options]
     * @param {number} [options.limit] - maximum jobs to recover in one call
     * @returns {Promise<{recovered: number, deadLettered: number}>}
     */
    async recoverExpiredLeases(options = {}) {

        const limit =
            Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 50;

        const now = new Date();

        // Find candidates first so the count is accurate, then claim each one
        // atomically. A job recovered by another worker between the two steps
        // simply fails its guarded update and is not double-counted.
        const candidates = await EmailOutbox.find({
            status: EMAIL_OUTBOX_STATUS.PROCESSING,
            processingLeaseUntil: { $ne: null, $lte: now },
        })
            .sort({ processingLeaseUntil: 1 })
            .limit(limit)
            .lean();

        let recovered = 0;

        let deadLettered = 0;

        for (const candidate of candidates) {

            // Retry budget exhausted → terminal state, not another retry.
            if (candidate.attempts >= candidate.maxAttempts) {

                const dead = await EmailOutbox.findOneAndUpdate(
                    {
                        _id: candidate._id,
                        status: EMAIL_OUTBOX_STATUS.PROCESSING,
                        processingLeaseUntil: { $ne: null, $lte: now },
                    },
                    {
                        $set: {
                            status: EMAIL_OUTBOX_STATUS.DEAD,
                            processingLeaseUntil: null,
                            lastError:
                                "Lease expired after the retry limit was reached; " +
                                "the message may have been delivered without being recorded",
                        },
                    },
                    { new: true }
                );

                if (dead) {

                    deadLettered += 1;

                }

                continue;

            }

            const updated = await EmailOutbox.findOneAndUpdate(
                {
                    _id: candidate._id,
                    status: EMAIL_OUTBOX_STATUS.PROCESSING,
                    processingLeaseUntil: { $ne: null, $lte: now },
                },
                {
                    $set: {
                        status: EMAIL_OUTBOX_STATUS.PENDING,
                        nextAttemptAt: now,
                        processingLeaseUntil: null,
                    },
                },
                { new: true }
            );

            if (updated) {

                recovered += 1;

            }

        }

        return { recovered, deadLettered };

    }

    // -----------------------------------------------------------------------
    // Preferences and recipient evaluation
    // -----------------------------------------------------------------------

    /**
     * Evaluate whether a job should be delivered, suppressed, or dead-lettered.
     *
     * Intended for the future worker to call immediately before sending, so a
     * preference change made after enqueue is still honoured.
     *
     * Decision order:
     *   1. Permanent recipient problems → `dead` (retrying cannot fix them).
     *   2. Mandatory email categories → always `send`, ignoring preferences.
     *   3. Non-mandatory category with email preference disabled → `suppress`.
     *   4. Otherwise → `send`.
     *
     * In-app notification records are completely independent of this method;
     * nothing here creates, reads, or suppresses a Notification.
     *
     * @param {object} job - an EmailOutbox document
     * @returns {Promise<{action: "send"|"suppress"|"dead", reason: string|null}>}
     */
    async evaluateDelivery(job) {

        if (!job) {

            throw new ApiError(400, "A job is required");

        }

        // --- Permanent recipient conditions --------------------------------
        // A job with no resolvable user can never be re-evaluated against a
        // preference, and a missing address can never be delivered.
        if (!job.recipientId) {

            return { action: "dead", reason: "No resolvable recipient" };

        }

        // `notificationPreferences` must be selected explicitly: omitting it
        // would make every category read as disabled.
        const recipient = await User.findById(job.recipientId).select(
            "email isActive isVerified notificationPreferences"
        );

        if (!recipient) {

            return { action: "dead", reason: "Recipient no longer exists" };

        }

        if (!recipient.email) {

            return { action: "dead", reason: "Recipient has no email address" };

        }

        // The address may have changed since enqueue. The job keeps its
        // captured address; a mismatch is a permanent condition because the
        // enqueue caller resolved the address at that time.
        if (recipient.email.toLowerCase() !== job.to.toLowerCase()) {

            return { action: "dead", reason: "Recipient email changed since enqueue" };

        }

        // `isActive` is the only account-activity flag the User schema
        // provides (User.js:68). There is no separate "banned" or "suspended"
        // field, so this is the sole supported check.
        if (recipient.isActive === false) {

            return { action: "dead", reason: "Recipient account is inactive" };

        }

        // --- Mandatory categories ignore preferences ------------------------
        if (MANDATORY_EMAIL_CATEGORIES.includes(job.category)) {

            return { action: "send", reason: null };

        }

        // --- Preference check ----------------------------------------------
        const effective = notificationService.getEffectivePreferences(recipient);
        const categoryPreference = effective[job.category];

        if (categoryPreference && categoryPreference.email === false) {

            return { action: "suppress", reason: "Email preference disabled for category" };

        }

        return { action: "send", reason: null };

    }

    // -----------------------------------------------------------------------
    // Send
    // -----------------------------------------------------------------------

    /**
     * Render and send a claimed job.
     *
     * The payload is re-validated against the current registry immediately
     * before rendering, so a template change cannot cause an unvalidated
     * payload to be rendered. Rendered HTML is never logged or persisted.
     *
     * The caller is responsible for the surrounding state transition
     * (markAsSent / recordFailureAndScheduleRetry / markAsDead).
     *
     * @param {object} job - an EmailOutbox document in `processing` state
     * @returns {Promise<object>} the nodemailer result
     * @throws {ApiError} 400 for a permanent payload/template problem
     */
    async sendJob(job) {

        if (!job) {

            throw new ApiError(400, "A job is required");

        }

        const template = this._requireTemplate(job.templateId);

        // Re-validate before rendering.
        const templateData = this._validateTemplateData(job.templateId, job.templateData);

        const html = template.render(templateData);

        return emailService.send({
            to: job.to,
            subject: this._resolveSubject(job.templateId),
            html,
        });

    }

    /**
     * Subject lines for the supported templates.
     *
     * These mirror the subjects used by the existing inline call sites so the
     * outbox produces identical messages once call sites are migrated.
     * @private
     */
    _resolveSubject(templateId) {

        switch (templateId) {

            case EMAIL_TEMPLATE_ID.VERIFY_EMAIL:
                return "Verify your ExpertHour email";

            case EMAIL_TEMPLATE_ID.FORGOT_PASSWORD:
                return "Reset your ExpertHour password";

            case EMAIL_TEMPLATE_ID.PAYMENT_SUCCESS:
                return "Payment Successful - Your Session is Confirmed";

            case EMAIL_TEMPLATE_ID.PAYMENT_FAILURE:
                return "Payment Failed - Action Required";

            case EMAIL_TEMPLATE_ID.PAYMENT_SUCCESS_CONSULTANT:
                return "New Booking Confirmed - Payment Received";

            case EMAIL_TEMPLATE_ID.PAYMENT_FAILURE_CONSULTANT:
                return "Booking Payment Failed";

            case EMAIL_TEMPLATE_ID.CONSULTANT_APPROVAL:
                return "Your ExpertHour consultant account is approved";

            case EMAIL_TEMPLATE_ID.CONSULTANT_REJECTION:
                return "Update on your ExpertHour consultant application";

            case EMAIL_TEMPLATE_ID.BOOKING_CANCELLED:
                return "Your ExpertHour booking was cancelled";

            case EMAIL_TEMPLATE_ID.BOOKING_DECLINED:
                return "Update on your ExpertHour booking request";

            case EMAIL_TEMPLATE_ID.REFUND_COMPLETED:
                return "Your ExpertHour refund is complete";

            case EMAIL_TEMPLATE_ID.REFUND_FAILED:
                return "Update on your ExpertHour refund";

            case EMAIL_TEMPLATE_ID.PAYOUT_COMPLETED:
                return "Your ExpertHour payout is complete";

            case EMAIL_TEMPLATE_ID.PAYOUT_FAILED:
                return "Update on your ExpertHour payout";

            case EMAIL_TEMPLATE_ID.SESSION_COMPLETED:
                return "Your ExpertHour session is complete";

            case EMAIL_TEMPLATE_ID.REVIEW_RECEIVED:
                return "You have a new ExpertHour review";

            case EMAIL_TEMPLATE_ID.EARNING_CANCELLED:
                return "Update on an ExpertHour earning";

            case EMAIL_TEMPLATE_ID.BOOKING_REMINDER_24H:
                return "Your ExpertHour session starts in 24 hours";

            case EMAIL_TEMPLATE_ID.BOOKING_REMINDER_1H:
                return "Your ExpertHour session starts in 1 hour";

            case EMAIL_TEMPLATE_ID.REVIEW_REQUEST:
                return "Please review your ExpertHour session";

            default:
                throw new ApiError(400, "Unsupported email template ID");

        }

    }

    /**
     * Build a dedupe key from its parts.
     *
     * Centralised so every caller produces the same shape:
     *   `${templateId}:${recipientId}:${subjectId}`
     *
     * @param {string} templateId
     * @param {string} recipientId
     * @param {string} subjectId
     * @returns {string}
     */
    buildDedupeKey(templateId, recipientId, subjectId) {

        this._requireTemplate(templateId);

        if (!recipientId || !mongoose.Types.ObjectId.isValid(recipientId)) {

            throw new ApiError(400, "A valid recipientId is required");

        }

        if (!subjectId || typeof subjectId !== "string" || subjectId.trim().length === 0) {

            throw new ApiError(400, "A subjectId is required");

        }

        return `${templateId}:${recipientId}:${subjectId.trim()}`;

    }

}

export default new EmailOutboxService();
