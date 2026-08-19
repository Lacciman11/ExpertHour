import mongoose from "mongoose";

/**
 * Payment Model — Paystack Integration
 *
 * Financial Convention:
 * ----------------------
 * All monetary values (amount, refundAmount) are stored as integers representing
 * the smallest currency unit (kobo for NGN).
 *
 * Examples:
 *   ₦1,000  →  100000 kobo
 *   ₦50,000 →  5000000 kobo
 *
 * This avoids floating-point precision issues and ensures financial accuracy.
 * The refund service must enforce: refundAmount <= amount
 */

const paymentSchema = new mongoose.Schema(
    {
        bookingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Booking",
            required: [true, "Booking ID is required"],
        },

        /**
         * Application-generated unique payment reference.
         * Used for idempotent payment initialization and webhook processing.
         * Format: EXP-{timestamp}-{random}
         */
        reference: {
            type: String,
            required: [true, "Payment reference is required"],
            unique: true,
        },

        /**
         * Payment amount in kobo (smallest NGN unit).
         * @type {number} Integer kobo value (e.g., 5000000 = ₦50,000)
         */
        amount: {
            type: Number,
            required: [true, "Amount is required"],
            min: [0, "Amount cannot be negative"],
        },

        /**
         * Currency code. Currently NGN only.
         * Stored in uppercase.
         */
        currency: {
            type: String,
            default: "NGN",
            enum: ["NGN"],
        },

        /**
         * Payment status lifecycle:
         *   pending    → awaiting payment
         *   processing → reconciliation in progress (atomic claim)
         *   success    → payment verified successfully
         *   failed     → payment failed or was abandoned
         *   abandoned  → user left payment page without completing
         */
        status: {
            type: String,
            enum: ["pending", "processing", "success", "failed", "abandoned"],
            default: "pending",
        },

        /**
         * Payment method/provider.
         * Currently only Paystack is supported.
         */
        paymentMethod: {
            type: String,
            default: "paystack",
            enum: ["paystack"],
        },

        /**
         * Paystack-generated transaction ID.
         * Separate from the application's own `reference`.
         * Used for efficient Paystack transaction lookups.
         * @type {number|null} Paystack transaction ID (e.g., 1234567890)
         */
        paystackTransactionId: {
            type: Number,
            default: null,
        },

        /**
         * Raw Paystack API response data for auditing/debugging.
         * The application's canonical payment state is `status`.
         * Do not make application logic depend exclusively on this field.
         */
        paystackResponse: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },

        /**
         * Timestamp when payment was successfully verified.
         * Only set after server-side payment verification.
         * NOT set when payment is merely initialized.
         */
        paidAt: {
            type: Date,
            default: null,
        },

        /**
         * Refund status lifecycle:
         *   none      → no refund initiated
         *   pending   → refund initiated with Paystack
         *   completed → refund successful
         *   failed    → refund failed
         */
        refundStatus: {
            type: String,
            enum: ["none", "pending", "completed", "failed"],
            default: "none",
        },

        /**
         * Refund amount in kobo (smallest NGN unit).
         * @type {number} Integer kobo value
         *
         * IMPORTANT: The refund service must enforce refundAmount <= amount
         * and prevent refunds exceeding the remaining refundable amount.
         * This cannot be validated at the Mongoose schema level because it
         * requires comparing two document fields.
         */
        refundAmount: {
            type: Number,
            default: 0,
            min: [0, "Refund amount cannot be negative"],
        },

        /**
         * Paystack-generated refund reference.
         */
        refundReference: {
            type: String,
            default: "",
        },

        /**
         * Raw Paystack refund response data for auditing.
         */
        refundResponse: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },

        /**
         * Timestamp when refund was completed.
         * Only set after successful refund.
         */
        refundedAt: {
            type: Date,
            default: null,
        },

        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Client ID is required"],
        },

        consultantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Consultant ID is required"],
        },

        /**
         * Reconciliation recovery metadata.
         *
         * lastReconciliationAttemptAt: timestamp of the most recent reconciliation attempt.
         * reconciliationAttempts: number of times reconciliation has been attempted.
         * processingStartedAt: timestamp when the payment entered "processing" state.
         *
         * These fields are used by the polling worker to determine whether a payment
         * is eligible for recovery, to enforce backoff, and to detect stale processing payments.
         */
        lastReconciliationAttemptAt: {
            type: Date,
            default: null,
        },

        reconciliationAttempts: {
            type: Number,
            default: 0,
            min: [0, "Reconciliation attempts cannot be negative"],
        },

        processingStartedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

/**
 * Indexes for efficient querying:
 * - bookingId: find payments for a specific booking
 * - reference: unique lookup for payment verification/webhooks (unique index auto-created by schema)
 * - status: filter payments by status
 * - refundStatus: filter payments by refund status
 * - paystackTransactionId: lookup by Paystack transaction ID
 * - createdAt: chronological ordering
 * - bookingId + status(pending) partial unique: ensures at most one pending payment per booking
 * - status + lastReconciliationAttemptAt: for polling worker queries
 * - status + processingStartedAt: for stale processing detection
 */
paymentSchema.index({ bookingId: 1 });
paymentSchema.index({ status: 1 });
paymentSchema.index({ refundStatus: 1 });
paymentSchema.index({ paystackTransactionId: 1 });
paymentSchema.index({ createdAt: -1 });
paymentSchema.index({ status: 1, lastReconciliationAttemptAt: 1 });
paymentSchema.index({ status: 1, processingStartedAt: 1 });

// Partial unique index: a booking may have at most ONE pending payment.
// Historical failed/abandoned payments are still allowed.
paymentSchema.index(
    { bookingId: 1 },
    {
        unique: true,
        partialFilterExpression: { status: "pending" },
    }
);

const Payment = mongoose.model("Payment", paymentSchema);

export default Payment;
