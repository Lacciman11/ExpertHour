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
    DEFAULT: 0.15, // 15%
});

export const CONSULTANT_SHARE_RATE = Object.freeze({
    DEFAULT: 0.85, // 85%
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