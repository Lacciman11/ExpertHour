export const USER_ROLES = Object.freeze({
    BUSINESS_OWNER: "BUSINESS_OWNER",
    CONSULTANT: "CONSULTANT",
    ADMIN: "ADMIN",
});

export const TOKEN_TYPES = Object.freeze({
    ACCESS: "ACCESS",
    REFRESH: "REFRESH",
});

export const BOOKING_STATUS = Object.freeze({
    PENDING: "pending",
    CONFIRMED: "confirmed",
    COMPLETED: "completed",
    CANCELLED: "cancelled",
});

export const CANCEL_ACTOR = Object.freeze({
    CLIENT: "client",
    CONSULTANT: "consultant",
    ADMIN: "admin",
});

export const REFUND_ELIGIBILITY = Object.freeze({
    FULL: "full",
    NONE: "none",
});

export const ATTENDANCE_STATUS = Object.freeze({
    NOT_STARTED: "not_started",
    IN_PROGRESS: "in_progress",
    COMPLETED: "completed",
    NO_SHOW_CLIENT: "no_show_client",
    NO_SHOW_CONSULTANT: "no_show_consultant",
    LATE_CLIENT: "late_client",
    LATE_CONSULTANT: "late_consultant",
});

export const PARTICIPANT = Object.freeze({
    CLIENT: "client",
    CONSULTANT: "consultant",
});

// ---------------------------------------------------------------------------
// ConsultantEarning Enums
// ---------------------------------------------------------------------------

export const EARNING_STATUS = Object.freeze({
    PENDING: "PENDING",
    HELD: "HELD",
    ELIGIBLE: "ELIGIBLE",
    IN_PAYOUT: "IN_PAYOUT",
    PAID: "PAID",
    CANCELLED: "CANCELLED",
    ADJUSTED: "ADJUSTED",
});

export const SESSION_OUTCOME = Object.freeze({
    COMPLETED: "COMPLETED",
    CUSTOMER_INSUFFICIENT: "CUSTOMER_INSUFFICIENT",
    CONSULTANT_INSUFFICIENT: "CONSULTANT_INSUFFICIENT",
    NEITHER_MET: "NEITHER_MET",
    CONSULTANT_CANCELLED: "CONSULTANT_CANCELLED",
    CONSULTANT_NO_SHOW: "CONSULTANT_NO_SHOW",
    CUSTOMER_NO_SHOW: "CUSTOMER_NO_SHOW",
});

export const HOLD_REASON = Object.freeze({
    DISPUTE_OPEN: "DISPUTE_OPEN",
    NEITHER_MET_INVESTIGATION: "NEITHER_MET_INVESTIGATION",
    ADMIN_HOLD: "ADMIN_HOLD",
    PAYOUT_THRESHOLD_NOT_MET: "PAYOUT_THRESHOLD_NOT_MET",
});

export const DISPUTE_RESOLUTION = Object.freeze({
    CUSTOMER_WINS: "CUSTOMER_WINS",
    CONSULTANT_WINS: "CONSULTANT_WINS",
    INCONCLUSIVE_PARTIAL_REFUND: "INCONCLUSIVE_PARTIAL_REFUND",
    INCONCLUSIVE_RESCHEDULE: "INCONCLUSIVE_RESCHEDULE",
    MANAGEMENT_ESCALATION: "MANAGEMENT_ESCALATION",
});

export const ADJUSTMENT_REASON = Object.freeze({
    PARTIAL_REFUND: "PARTIAL_REFUND",
    FULL_REFUND: "FULL_REFUND",
    DISPUTE_RESOLUTION: "DISPUTE_RESOLUTION",
    ADMINISTRATIVE_ADJUSTMENT: "ADMINISTRATIVE_ADJUSTMENT",
});

export const PLATFORM_COMMISSION_RATE = Object.freeze({
    DEFAULT: 0.18, // 18%
});

export const CONSULTANT_SHARE_RATE = Object.freeze({
    DEFAULT: 0.82, // 82%
});

// ---------------------------------------------------------------------------
// Payout Enums
// ---------------------------------------------------------------------------

export const PAYOUT_STATUS = Object.freeze({
    PENDING: "PENDING",
    PROCESSING: "PROCESSING",
    COMPLETED: "COMPLETED",
    FAILED: "FAILED",
    PARTIAL: "PARTIAL",
    CANCELLED: "CANCELLED",
});

// ---------------------------------------------------------------------------
// Notification Categories
// ---------------------------------------------------------------------------

// Stable notification categories. Every Notification document carries exactly
// one of these values, and every User.notificationPreferences entry is keyed
// by the same value. Adding a category requires adding it here AND to the
// User preference schema defaults.
export const NOTIFICATION_CATEGORY = Object.freeze({
    BOOKING: "booking",
    CONSULTATION: "consultation",
    PAYMENT: "payment",
    REFUND: "refund",
    EARNING: "earning",
    PAYOUT: "payout",
    REVIEW: "review",
    ACCOUNT: "account",
    ADMIN: "admin",
    MARKETING: "marketing",
});

// Categories whose email delivery is mandatory and cannot be disabled by a
// user preference. Security and transactional receipts must always be sent.
// Preference enforcement happens at delivery time (out of scope for the
// persistence layer); this list is the single source of truth for it.
export const MANDATORY_EMAIL_CATEGORIES = Object.freeze([
    NOTIFICATION_CATEGORY.ACCOUNT,
    NOTIFICATION_CATEGORY.PAYMENT,
    NOTIFICATION_CATEGORY.REFUND,
]);

// Categories whose in-app delivery is mandatory and cannot be disabled.
export const MANDATORY_IN_APP_CATEGORIES = Object.freeze([
    NOTIFICATION_CATEGORY.ACCOUNT,
    NOTIFICATION_CATEGORY.PAYMENT,
    NOTIFICATION_CATEGORY.REFUND,
    NOTIFICATION_CATEGORY.ADMIN,
]);

// ---------------------------------------------------------------------------
// Email Outbox
// ---------------------------------------------------------------------------

// Lifecycle states for an EmailOutbox job.
//
//   pending    → enqueued and eligible to be claimed once nextAttemptAt is due
//   processing → claimed by a worker; protected by processingLeaseUntil
//   sent       → the provider accepted the message and delivery is recorded
//   suppressed → intentionally NOT sent (user preference or permanent
//                recipient condition). Deliberately distinct from `sent` so a
//                skipped email is never reported as delivered.
//   failed     → a transient failure occurred; retry is scheduled
//   dead       → retry limit exhausted, or a permanent failure that retrying
//                cannot fix (invalid recipient, invalid payload)
export const EMAIL_OUTBOX_STATUS = Object.freeze({
    PENDING: "pending",
    PROCESSING: "processing",
    SENT: "sent",
    SUPPRESSED: "suppressed",
    FAILED: "failed",
    DEAD: "dead",
});

// Stable identifiers for the email templates that exist today.
//
// Sourced from the exports of src/services/email/index.js. Adding a template
// requires adding it here AND to the allowlist in
// src/services/email-outbox.service.js, which maps each id to its render
// function and permitted payload keys.
export const EMAIL_TEMPLATE_ID = Object.freeze({
    VERIFY_EMAIL: "verify-email",
    FORGOT_PASSWORD: "forgot-password",
    PAYMENT_SUCCESS: "payment-success",
    PAYMENT_FAILURE: "payment-failure",
    PAYMENT_SUCCESS_CONSULTANT: "payment-success-consultant",
    PAYMENT_FAILURE_CONSULTANT: "payment-failure-consultant",
    CONSULTANT_APPROVAL: "consultant-approval",
    CONSULTANT_REJECTION: "consultant-rejection",
    BOOKING_CANCELLED: "booking-cancelled",
    BOOKING_DECLINED: "booking-declined",
    REFUND_COMPLETED: "refund-completed",
    REFUND_FAILED: "refund-failed",
    PAYOUT_COMPLETED: "payout-completed",
    PAYOUT_FAILED: "payout-failed",
    SESSION_COMPLETED: "session-completed",
    REVIEW_RECEIVED: "review-received",
    EARNING_CANCELLED: "earning-cancelled",
    BOOKING_REMINDER_24H: "booking-reminder-24h",
    BOOKING_REMINDER_1H: "booking-reminder-1h",
    REVIEW_REQUEST: "review-request",
});

export const MINIMUM_PAYOUT_KOBO = 1000000; // ₦10,000 in kobo

// ---------------------------------------------------------------------------
// Business Timezone
// ---------------------------------------------------------------------------

// ExpertHour is a Nigeria-only platform. Nigeria (Africa/Lagos) is permanently
// UTC+1 and does not observe daylight saving time. This is the single source
// of truth for the application business timezone.
export const APP_TIMEZONE = "Africa/Lagos";

// Africa/Lagos fixed UTC offset (no DST). Used to parse wall-clock booking
// times (which are stored as local Lagos date/time strings) into absolute
// instants. Kept as a named constant so business-rule code never contains a
// magic inline "+01:00".
export const APP_TIMEZONE_UTC_OFFSET = "+01:00";

// ---------------------------------------------------------------------------
// Cancellation Window
// ---------------------------------------------------------------------------

// 36-hour cancellation window expressed as an integer number of milliseconds.
// Using integer timestamp arithmetic avoids floating-point hour calculations
// (difference / (1000 * 60 * 60)) that are imprecise at the boundary.
export const CANCELLATION_WINDOW_MS = 36 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Slot Granularity
// ---------------------------------------------------------------------------

// Each booking claims one or more 30-minute slot locks.
// The available-slots endpoint and booking service both use this granularity.
export const SLOT_GRANULARITY_MINUTES = 30;

// ---------------------------------------------------------------------------
// Application Experience Options
// ---------------------------------------------------------------------------

export const EXPERIENCE_OPTIONS = Object.freeze([
    "5-10 years",
    "11-15 years",
    "16-20 years",
    "21-25 years",
    "25+ years",
]);

// ---------------------------------------------------------------------------
// Application Industry Options
// ---------------------------------------------------------------------------

export const INDUSTRY_OPTIONS = Object.freeze([
    "Financial Services",
    "Technology",
    "Healthcare",
    "Energy & Utilities",
    "Manufacturing",
    "Retail & Consumer",
    "Telecommunications",
    "Professional Services",
    "Education",
    "Government / Public Sector",
    "Other",
]);

// ---------------------------------------------------------------------------
// Application Expertise Options
// ---------------------------------------------------------------------------

export const EXPERTISE_OPTIONS = Object.freeze([
    "Business Strategy",
    "Business Development",
    "Finance & Accounting",
    "Marketing & Sales",
    "Leadership & Management",
    "Human Resources",
    "Technology & Digital Transformation",
    "Data & Analytics",
    "Operations & Supply Chain",
    "Legal & Compliance",
    "Project & Product Management",
    "Entrepreneurship",
    "Other",
]);