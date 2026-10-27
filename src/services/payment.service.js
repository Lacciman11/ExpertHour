import axios from "axios";
import crypto from "crypto";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import googleCalendarService from "./google-calendar.service.js";
import emailOutboxService from "./email-outbox.service.js";
import domainNotificationEmitter from "./domain-notification.emitter.js";
import {
    EMAIL_TEMPLATE_ID,
    NOTIFICATION_CATEGORY,
} from "../utils/constants.js";
import { koboToNaira } from "../utils/currency.js";
import paymentLogger from "../utils/logger.js";
import ApiError from "../utils/ApiError.js";
import env from "../config/env.js";

/**
 * Payment reconciliation error with classification for HTTP mapping.
 */
class PaymentError extends Error {

    constructor(message, type = "transient") {

        super(message);

        this.type = type; // "integrity" | "transient" | "not_found"

        this.name = "PaymentError";

    }

}

// Helper to get user email safely
async function getUserEmail(userId) {
    const user = await User.findById(userId).select("email");
    return user?.email || "client@experthour.com";
}

/**
 * Validate Paystack initialize response.
 * Returns true if the response contains a valid authorization URL and reference.
 */
function isValidPaystackInitializeResponse(response) {
    return (
        response &&
        response.data &&
        response.data.status === true &&
        response.data.data &&
        typeof response.data.data.authorization_url === "string" &&
        response.data.data.authorization_url.length > 0 &&
        typeof response.data.data.reference === "string" &&
        response.data.data.reference.length > 0
    );
}

/**
 * Paystack API client with retry logic and logging
 */
class PaystackClient {

    /**
     * Make a Paystack API request with exponential backoff retry
     */
    async request(method, endpoint, data = null, retries = 3) {

        const secrets = this._getSecrets();
        const url = `https://api.paystack.co${endpoint}`;

        const logPrefix = `[Paystack ${method} ${endpoint}]`;

        for (let attempt = 0; attempt < retries; attempt++) {

            const secret = secrets[attempt % secrets.length];

            try {

                const config = {

                    headers: {

                        Authorization: `Bearer ${secret}`,

                        "Content-Type": "application/json",

                    },

                    timeout: 30000,

                };

                paymentLogger.info("paystack_request", {

                    event: "paystack_request",

                    method,

                    endpoint,

                    attempt: attempt + 1,

                    retries,

                });

                let response;

                if (method === "GET") {

                    response = await axios.get(url, config);

                } else if (method === "POST") {

                    response = await axios.post(url, data, config);

                }

                paymentLogger.info("paystack_response", {

                    event: "paystack_response",

                    method,

                    endpoint,

                    status: response.status,

                });

                return response;

            } catch (error) {

                const status = error.response?.status;
                const message = error.response?.data?.message || error.message;

                paymentLogger.error("paystack_request_failed", {

                    event: "paystack_request_failed",

                    method,

                    endpoint,

                    attempt: attempt + 1,

                    status,

                    error: message,

                });

                // Don't retry on client errors (4xx) except 429
                if (status && status >= 400 && status < 500 && status !== 429) {

                    throw new Error(`Paystack API error (${status}): ${message}`);

                }

                // Don't retry on last attempt
                if (attempt === retries - 1) {

                    throw new Error(`Paystack API failed after ${retries} attempts: ${message}`);

                }

                // Exponential backoff: 1s, 2s, 4s
                const delay = Math.pow(2, attempt) * 1000;

                paymentLogger.info("paystack_retry", {

                    event: "paystack_retry",

                    method,

                    endpoint,

                    delayMs: delay,

                });

                await new Promise(resolve => setTimeout(resolve, delay));

            }

        }

    }

    /**
     * Get Paystack secrets for rotation support
     * Supports PAYSTACK_SECRET_KEY and optional PAYSTACK_SECRET_KEY_OLD
     */
    _getSecrets() {

        const primary = process.env.PAYSTACK_SECRET_KEY;

        const secondary = process.env.PAYSTACK_SECRET_KEY_OLD;

        if (!primary) {

            throw new Error("PAYSTACK_SECRET_KEY is not configured");

        }

        const secrets = [primary];

        if (secondary) {

            secrets.push(secondary);

        }

        return secrets;

    }

}

const paystackClient = new PaystackClient();

class PaymentService {

    async initializePayment(bookingId, userId, correlationId) {

        paymentLogger.setContext({ correlationId });

        const booking = await Booking.findById(bookingId);

        if (!booking) {

            throw new Error("Booking not found");

        }

        // Verify booking ownership
        if (booking.clientId.toString() !== userId.toString()) {

            throw new Error("Not authorized to pay for this booking");

        }

        // Verify booking is eligible for payment
        if (booking.status === "cancelled") {

            throw new Error("Cannot pay for a cancelled booking");

        }

        if (booking.status === "completed") {

            throw new Error("Cannot pay for a completed booking");

        }

        // Verify booking amount is valid
        if (!booking.amount || booking.amount <= 0) {

            throw new Error("Invalid booking amount");

        }

        // Check for existing successful payment (read-only, safe)
        const successfulPayment = await Payment.findOne({
            bookingId: booking._id,
            status: "success",
        });

        if (successfulPayment) {

            paymentLogger.info("payment_already_paid", {

                event: "payment_already_paid",

                bookingId: booking._id.toString(),

                reference: successfulPayment.reference,

            });

            return {

                success: false,

                message: "This booking has already been paid",

                reference: successfulPayment.reference,

                status: "success",

            };

        }

        // Check for payment already being processed.
        // A "processing" payment means reconciliation is in progress.
        // Do not create another payment for the same booking.
        const processingPayment = await Payment.findOne({
            bookingId: booking._id,
            status: "processing",
        });

        if (processingPayment) {

            paymentLogger.info("payment_already_processing", {

                event: "payment_already_processing",

                bookingId: booking._id.toString(),

                reference: processingPayment.reference,

            });

            return {

                success: false,

                message: "Payment is already being processed for this booking",

                reference: processingPayment.reference,

                status: "processing",

            };

        }

        // Use booking.amount directly — already stored in kobo
        const amountInKobo = booking.amount;
        const userEmail = await getUserEmail(userId);

        // Atomically claim a pending payment slot.
        // The partial unique index on { bookingId: 1 } where status: "pending"
        // ensures at most one pending payment per booking.
        // If two concurrent requests race, only one will insert; the other will
        // get the existing pending document.
        const reference = `EXP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        let payment;
        let claimed = false;

        for (let attempt = 0; attempt < 3; attempt++) {

            try {

                payment = await Payment.findOneAndUpdate(
                    { bookingId: booking._id, status: "pending" },
                    {
                        $setOnInsert: {
                            bookingId: booking._id,
                            reference,
                            amount: amountInKobo,
                            currency: "NGN",
                            status: "pending",
                            paymentMethod: "paystack",
                            clientId: booking.clientId,
                            consultantId: booking.consultantId,
                        },
                    },
                    { new: true, upsert: true }
                );

                claimed = true;
                break;

            } catch (error) {

                // Duplicate key on partial unique index means another request
                // created the pending payment between our find and insert.
                // Retry to fetch the existing pending payment.
                if (error.code === 11000 && attempt < 2) {

                    paymentLogger.warn("payment_race_condition", {

                        event: "payment_race_condition",

                        bookingId: booking._id.toString(),

                        attempt: attempt + 1,

                    });

                    await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));

                    continue;

                }

                throw error;

            }

        }

        if (!claimed || !payment) {

            throw new Error("Failed to claim pending payment slot");

        }

        // Call Paystack with the payment's reference.
        // If this is a newly created payment, Paystack creates a new transaction.
        // If this is an existing pending payment, Paystack returns the existing transaction.
        const payload = {

            email: userEmail,

            amount: amountInKobo,

            reference: payment.reference,

            callback_url: `${env.appUrl}/booking/confirmation`,

            metadata: {

                bookingId: booking._id.toString(),

                clientId: userId.toString(),

                consultantId: booking.consultantId.toString(),

            },

        };

        let response;

        try {

            response = await paystackClient.request("POST", "/transaction/initialize", payload);

        } catch (error) {

            paymentLogger.error("paystack_initialization_failed", {

                event: "paystack_initialization_failed",

                bookingId: booking._id.toString(),

                reference: payment.reference,

                error: error.message,

            });

            // Payment remains in pending state — safe to retry.
            // Do NOT mark booking as paid.
            throw new Error("Failed to initialize payment: " + error.message);

        }

        // Validate Paystack response before treating it as a valid initialization.
        // A 200 response with missing fields is NOT a valid transaction.
        if (!isValidPaystackInitializeResponse(response)) {

            paymentLogger.error("invalid_paystack_initialize_response", {

                event: "invalid_paystack_initialize_response",

                bookingId: booking._id.toString(),

                reference: payment.reference,

            });

            // Payment remains in pending state — safe to retry.
            // Do NOT mark booking as paid.
            throw new Error("Invalid Paystack initialization response");

        }

        // Update payment with Paystack response data
        payment.paystackTransactionId = response.data.data.id || null;
        payment.paystackResponse = response.data;
        await payment.save();

        // Update booking with current payment reference
        booking.paymentReference = payment.reference;
        booking.paymentStatus = "pending";
        await booking.save();

        paymentLogger.info("payment_initialized", {

            event: "payment_initialized",

            bookingId: booking._id.toString(),

            reference: payment.reference,

            amount: payment.amount,

            currency: payment.currency,

        });

        return {

            authorizationUrl: response.data.data.authorization_url,

            accessCode: response.data.data.access_code,

            reference: payment.reference,

            status: "pending",

        };

    }

    async retryPayment(bookingId, userId, correlationId) {

        paymentLogger.setContext({ correlationId });

        const booking = await Booking.findById(bookingId);

        if (!booking) {

            throw new Error("Booking not found");

        }

        if (booking.clientId.toString() !== userId.toString()) {

            throw new Error("Not authorized to retry payment for this booking");

        }

        // Verify booking is eligible for payment — same guards as initializePayment.
        if (booking.status === "cancelled") {

            throw new Error("Cannot retry payment for a cancelled booking");

        }

        if (booking.status === "completed") {

            throw new Error("Cannot retry payment for a completed booking");

        }

        // Check for existing successful payment (read-only, safe).
        // Do not create another Paystack transaction if already paid.
        const successfulPayment = await Payment.findOne({
            bookingId: booking._id,
            status: "success",
        });

        if (successfulPayment) {

            paymentLogger.info("payment_retry_already_paid", {

                event: "payment_retry_already_paid",

                bookingId: booking._id.toString(),

                reference: successfulPayment.reference,

            });

            return {

                success: false,

                message: "This booking has already been paid",

                reference: successfulPayment.reference,

                status: "success",

            };

        }

        // Check for payment already being processed.
        // A "processing" payment means reconciliation is in progress.
        // Do not create another payment for the same booking.
        const processingPayment = await Payment.findOne({
            bookingId: booking._id,
            status: "processing",
        });

        if (processingPayment) {

            paymentLogger.info("payment_retry_already_processing", {

                event: "payment_retry_already_processing",

                bookingId: booking._id.toString(),

                reference: processingPayment.reference,

            });

            return {

                success: false,

                message: "Payment is already being processed for this booking",

                reference: processingPayment.reference,

                status: "processing",

            };

        }

        // Use booking.amount directly — already stored in kobo
        const amountInKobo = booking.amount;

        // Atomically claim a pending payment slot.
        // The partial unique index on { bookingId: 1 } where status: "pending"
        // ensures at most one pending payment per booking.
        // If a pending payment already exists, it is reused (its reference is preserved).
        // If two concurrent retry requests race, only one will insert; the other
        // will get the existing pending document.
        const reference = `EXP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        let payment;
        let claimed = false;

        for (let attempt = 0; attempt < 3; attempt++) {

            try {

                payment = await Payment.findOneAndUpdate(
                    { bookingId: booking._id, status: "pending" },
                    {
                        $setOnInsert: {
                            bookingId: booking._id,
                            reference,
                            amount: amountInKobo,
                            currency: "NGN",
                            status: "pending",
                            paymentMethod: "paystack",
                            clientId: booking.clientId,
                            consultantId: booking.consultantId,
                        },
                    },
                    { new: true, upsert: true }
                );

                claimed = true;
                break;

            } catch (error) {

                // Duplicate key on partial unique index means another request
                // created the pending payment between our find and insert.
                // Retry to fetch the existing pending payment.
                if (error.code === 11000 && attempt < 2) {

                    paymentLogger.warn("payment_retry_race_condition", {

                        event: "payment_retry_race_condition",

                        bookingId: booking._id.toString(),

                        attempt: attempt + 1,

                    });

                    await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));

                    continue;

                }

                throw error;

            }

        }

        if (!claimed || !payment) {

            throw new Error("Failed to claim pending payment slot for retry");

        }

        // Call Paystack with the payment's reference.
        // If this is a newly created payment, Paystack creates a new transaction.
        // If this is an existing pending payment, Paystack returns the existing transaction.
        const clientEmail = await getUserEmail(userId);

        const payload = {

            email: clientEmail,

            amount: amountInKobo,

            reference: payment.reference,

            callback_url: `${env.appUrl}/booking/confirmation`,

            metadata: {

                bookingId: booking._id.toString(),

                clientId: userId.toString(),

                consultantId: booking.consultantId.toString(),

            },

        };

        let response;

        try {

            response = await paystackClient.request("POST", "/transaction/initialize", payload);

        } catch (error) {

            paymentLogger.error("paystack_retry_initialization_failed", {

                event: "paystack_retry_initialization_failed",

                bookingId: booking._id.toString(),

                reference: payment.reference,

                error: error.message,

            });

            // Payment remains in pending state — safe to retry.
            // Do NOT mark booking as paid.
            throw new Error("Failed to retry payment: " + error.message);

        }

        // Validate Paystack response before treating it as a valid initialization.
        if (!isValidPaystackInitializeResponse(response)) {

            paymentLogger.error("invalid_paystack_retry_response", {

                event: "invalid_paystack_retry_response",

                bookingId: booking._id.toString(),

                reference: payment.reference,

            });

            // Payment remains in pending state — safe to retry.
            throw new Error("Invalid Paystack initialization response for retry");

        }

        // Update payment with Paystack response data
        payment.paystackTransactionId = response.data.data.id || null;
        payment.paystackResponse = response.data;
        await payment.save();

        // Update booking with current payment reference
        booking.paymentReference = payment.reference;
        booking.paymentStatus = "pending";
        booking.refundStatus = "none";
        await booking.save();

        paymentLogger.info("payment_retry_success", {

            event: "payment_retry_success",

            bookingId: bookingId.toString(),

            reference: payment.reference,

        });

        return {

            authorizationUrl: response.data.data.authorization_url,

            accessCode: response.data.data.access_code,

            reference: payment.reference,

            status: "pending",

        };

    }

    /**
     * Central payment reconciliation function.
     *
     * This is the SINGLE SOURCE OF TRUTH for determining whether a booking
     * has been paid. All verification paths (manual, webhook, polling) must
     * use this function to ensure consistent validation and state updates.
     *
     * State machine:
     *   pending  → processing → success
     *   pending  → processing → failed
     *   pending  → processing → pending (non-terminal Paystack status)
     *
     * @param {string} reference - Application payment reference (Payment.reference)
     * @returns {Object} Reconciliation result with payment, booking, and status
     */
    async reconcilePayment(reference, correlationId, options = {}) {
        const { skipClaim = false } = options;

        paymentLogger.setContext({ correlationId });

        // 1. Find the Payment by our application reference.
        const payment = await Payment.findOne({ reference });

        if (!payment) {

            throw new PaymentError("Payment record not found for this reference", "not_found");

        }

        // 2. Find the associated Booking.
        const booking = await Booking.findById(payment.bookingId);

        if (!booking) {

            throw new PaymentError("Booking not found for this payment", "not_found");

        }

        // 3. Idempotency: if already successful, return existing state safely.
        if (payment.status === "success") {

            paymentLogger.info("payment_reconciliation_skipped_already_verified", {

                event: "payment_reconciliation_skipped_already_verified",

                reference,

                bookingId: booking._id.toString(),

            });

            return {

                success: true,

                payment,

                booking,

                meetingLink: booking.meetingLink,

                alreadyVerified: true,

            };

        }

        // 4. If another request is already processing this payment, return processing state.
        // Skip this check when skipClaim is true (manual recovery already claimed).
        if (!skipClaim && payment.status === "processing") {
 
            paymentLogger.info("payment_reconciliation_skipped_processing", {
 
                event: "payment_reconciliation_skipped_processing",
 
                reference,
 
                bookingId: booking._id.toString(),
 
            });
 
            return {
 
                success: false,
 
                payment,
 
                booking,
 
                reason: "Payment is currently being processed",
 
                status: "processing",
 
            };
 
        }
 
        // 5. Atomically claim the payment for processing.
        // Only a payment in "pending" state can be claimed.
        // This prevents concurrent reconciliation from both succeeding.
        // Skip when skipClaim is true (manual recovery already claimed).
        if (!skipClaim) {
            const claimed = await Payment.findOneAndUpdate(
                { reference, status: "pending" },
                {
                    $set: {
                        status: "processing",
                        processingStartedAt: new Date(),
                    }
                },
                { new: true }
            );
 
            if (!claimed) {
 
                // Claim failed — another request claimed it, or state changed.
                // Re-fetch to determine current state.
                const refreshed = await Payment.findOne({ reference });
 
                if (!refreshed) {
 
                    throw new PaymentError("Payment record not found for this reference", "not_found");
 
                }
 
                if (refreshed.status === "success") {
 
                    return {
 
                        success: true,
 
                        payment: refreshed,
 
                        booking,
 
                        meetingLink: booking.meetingLink,
 
                        alreadyVerified: true,
 
                    };
 
                }
 
                return {
 
                    success: false,
 
                    payment: refreshed,
 
                    booking,
 
                    reason: "Payment is currently being processed by another request",
 
                    status: "processing",
 
                };
 
            }
 
            // We now own the processing claim.
            payment.status = "processing";
            payment.processingStartedAt = new Date();
            payment.reconciliationAttempts += 1;
            payment.lastReconciliationAttemptAt = new Date();
            await payment.save();
        }

        try {

            // 6. Verify the Paystack transaction using the reference.
            let response;

            try {

                response = await paystackClient.request("GET", `/transaction/verify/${reference}`);

            } catch (error) {

                paymentLogger.error("paystack_verification_failed", {

                    event: "paystack_verification_failed",

                    reference,

                    error: error.message,

                });

                // Revert to pending on transient Paystack/network error.
                payment.status = "pending";
                payment.processingStartedAt = null;
                await payment.save();

                throw new PaymentError("Failed to verify payment with Paystack: " + error.message, "transient");

            }

            const paystackData = response.data;

            // 7. Validate the Paystack response structure.
            if (!paystackData || !paystackData.data || typeof paystackData.data !== "object") {

                payment.status = "pending";
                payment.processingStartedAt = null;
                await payment.save();

                throw new PaymentError("Invalid Paystack verification response: missing transaction data", "integrity");

            }

            const transaction = paystackData.data;

            // 8. Classify Paystack transaction status.
            const paystackStatus = transaction.status;

            // 9. Handle non-terminal Paystack statuses.
            // Non-terminal statuses mean the transaction is still capable of completing.
            // Do NOT mark the payment as failed.
            if (!this._isTerminalPaystackStatus(paystackStatus) && paystackStatus !== "success") {

                // Revert to pending — safe to retry later via polling/manual verification.
                payment.status = "pending";
                payment.processingStartedAt = null;
                payment.paystackResponse = paystackData;
                await payment.save();

                paymentLogger.info("payment_reconciliation_non_terminal", {

                    event: "payment_reconciliation_non_terminal",

                    reference,

                    bookingId: booking._id.toString(),

                    paystackStatus,

                });

                return {

                    success: false,

                    payment,

                    booking,

                    reason: `Transaction is still pending (Paystack status: "${paystackStatus}")`,

                    status: "pending",

                };

            }

            // 10. Handle terminal Paystack failure.
            if (this._isTerminalPaystackStatus(paystackStatus)) {

                payment.status = "failed";
                payment.paystackResponse = paystackData;
                await payment.save();

                booking.paymentStatus = "failed";
                await booking.save();

                await this._sendPaymentFailureEmails(booking, reference, correlationId);

                // Persist the in-app notification for the client. Failure-isolated:
                // a notification failure must not reverse the terminal payment state
                // or prevent the failure emails from being queued.
                await this._sendPaymentFailureNotification(booking, payment, reference);

                paymentLogger.info("payment_reconciliation_terminal_failure", {

                    event: "payment_reconciliation_terminal_failure",

                    reference,

                    bookingId: booking._id.toString(),

                    paystackStatus,

                });

                return {

                    success: false,

                    payment,

                    booking,

                    reason: `Transaction failed (Paystack status: "${paystackStatus}")`,

                };

            }

            // 11. Paystack status is "success" — validate all integrity checks.
            try {

                this._validateReferenceIntegrity(transaction, payment);

                this._validateAmountIntegrity(transaction, payment);

                this._validateCurrencyIntegrity(transaction, payment);

                this._validateBookingIntegrity(payment, booking);

            } catch (integrityError) {

                // Revert to pending on integrity failure so the payment can be retried later.
                payment.status = "pending";
                payment.processingStartedAt = null;
                await payment.save();

                throw integrityError;

            }

            // 12. Prevent multiple successful payments for the same booking.
            const duplicatePayment = await this._checkDuplicateSuccessfulPayment(payment);

            if (duplicatePayment) {

                // Leave payment in "processing" state for audit/refund handling.
                // Do NOT mark as success, do NOT mark as failed.
                payment.paystackResponse = paystackData;
                await payment.save();

                paymentLogger.error("duplicate_settlement_detected", {

                    event: "duplicate_settlement_detected",

                    reference,

                    bookingId: booking._id.toString(),

                    existingPaymentId: duplicatePayment._id.toString(),

                    existingReference: duplicatePayment.reference,

                });

                throw new PaymentError(
                    `Booking already has a successful payment (${duplicatePayment.reference}). ` +
                    `This transaction is preserved for audit/refund handling.`,
                    "integrity"
                );

            }

            // 13. Validate booking status transition.
            this._validateBookingStatusTransition(booking);

            // 14. Validate and normalize paid_at.
            const paidAt = this._validatePaidAt(transaction.paid_at);

            // 15. MongoDB transaction for atomic Payment + Booking updates.
            const session = await mongoose.startSession();
            session.startTransaction();

            try {

                // Update Payment
                payment.status = "success";
                payment.paystackTransactionId = transaction.id || payment.paystackTransactionId;
                payment.paystackResponse = paystackData;
                payment.paidAt = paidAt;
                payment.processingStartedAt = null;
                await payment.save({ session });

                // Update Booking
                booking.paymentStatus = "paid";
                booking.paidAt = paidAt;

                await booking.save({ session });

                await session.commitTransaction();
                session.endSession();

                paymentLogger.info("payment_transaction_committed", {

                    event: "payment_transaction_committed",

                    reference,

                    bookingId: booking._id.toString(),

                });

            } catch (dbError) {

                await session.abortTransaction();
                session.endSession();

                // Revert payment to pending on DB failure.
                payment.status = "pending";
                payment.processingStartedAt = null;
                await payment.save();

                paymentLogger.error("payment_transaction_failed", {

                    event: "payment_transaction_failed",

                    reference,

                    bookingId: booking._id.toString(),

                    error: dbError.message,

                });

                throw new PaymentError("Database error during settlement: " + dbError.message, "transient");

            }

            // 16. External side effects AFTER successful DB commit.
            // Do NOT put external calls inside the MongoDB transaction.
            const meetingLink = booking.meetingLink;

            // Persist the in-app success notification for the client. This runs
            // AFTER the MongoDB transaction committed, so a notification failure
            // can never reverse the success state. Failure-isolated: it cannot
            // block the existing success-email path below.
            await this._sendPaymentSuccessNotification(booking, payment);

            // 17. Send email notifications after DB commit.
            await this._sendPaymentSuccessEmails(booking, meetingLink, reference, correlationId);

            paymentLogger.info("payment_reconciliation_success", {

                event: "payment_reconciliation_success",

                reference,

                bookingId: booking._id.toString(),

                amount: payment.amount,

                currency: payment.currency,

            });

            return {

                success: true,

                payment,

                booking,

                meetingLink,

                alreadyVerified: false,

            };

        } catch (error) {

            // If the error is already a PaymentError, re-throw as-is.
            if (error instanceof PaymentError) {

                throw error;

            }

            // For unexpected errors, revert to pending if still processing.
            if (payment.status === "processing") {

                payment.status = "pending";
                payment.processingStartedAt = null;
                await payment.save();

            }

            paymentLogger.error("payment_reconciliation_unexpected_error", {

                event: "payment_reconciliation_unexpected_error",

                reference,

                bookingId: booking._id.toString(),

                error: error.message,

            });

            throw new PaymentError("Reconciliation failed: " + error.message, "transient");

        }

    }

    async manualReconcilePayment(reference, adminId, correlationId) {
        paymentLogger.setContext({ correlationId });

        const PaymentRecoveryAudit = (await import("../models/PaymentRecoveryAudit.js")).default;

        // 1. Find the Payment by reference.
        const payment = await Payment.findOne({ reference });

        if (!payment) {
            // Write audit record for not-found
            try {
                await PaymentRecoveryAudit.create({
                    paymentReference: reference,
                    paymentId: null,
                    initiatedBy: adminId,
                    outcome: "not_found",
                    reason: "Payment record not found for this reference",
                });
            } catch (auditError) {
                paymentLogger.error("payment_recovery_audit_write_failed", {
                    event: "payment_recovery_audit_write_failed",
                    error: auditError.message,
                });
            }
            throw new PaymentError("Payment record not found for this reference", "not_found");
        }

        const booking = await Booking.findById(payment.bookingId);

        if (!booking) {
            throw new PaymentError("Booking not found for this payment", "not_found");
        }

        const attemptsBefore = payment.reconciliationAttempts || 0;

        // 2. Reject terminal payments.
        if (["success", "failed", "abandoned"].includes(payment.status)) {
            try {
                await PaymentRecoveryAudit.create({
                    paymentReference: reference,
                    paymentId: payment._id,
                    initiatedBy: adminId,
                    outcome: "terminal",
                    reason: `Payment is in terminal state: ${payment.status}`,
                    reconciliationAttemptsBefore: attemptsBefore,
                    reconciliationAttemptsAfter: attemptsBefore,
                });
            } catch (auditError) {
                paymentLogger.error("payment_recovery_audit_write_failed", {
                    event: "payment_recovery_audit_write_failed",
                    error: auditError.message,
                });
            }
            throw new PaymentError(`Cannot recover payment in terminal state: ${payment.status}`, "terminal");
        }

        // 3. Check active processing (stale timeout policy).
        const now = new Date();
        const processingTimeoutMs = env.paymentReconciliation.processingTimeoutMs;
        if (payment.status === "processing" && payment.processingStartedAt) {
            const elapsed = now.getTime() - new Date(payment.processingStartedAt).getTime();
            if (elapsed < processingTimeoutMs) {
                try {
                    await PaymentRecoveryAudit.create({
                        paymentReference: reference,
                        paymentId: payment._id,
                        initiatedBy: adminId,
                        outcome: "processing",
                        reason: "Payment is actively being processed",
                        reconciliationAttemptsBefore: attemptsBefore,
                        reconciliationAttemptsAfter: attemptsBefore,
                    });
                } catch (auditError) {
                    paymentLogger.error("payment_recovery_audit_write_failed", {
                        event: "payment_recovery_audit_write_failed",
                        error: auditError.message,
                    });
                }
                throw new PaymentError("Payment is currently being processed", "processing");
            }
        }

        // 4. Atomically claim with reset.
        const claimed = await Payment.findOneAndUpdate(
            { reference, status: { $in: ["pending", "processing"] } },
            {
                $set: {
                    status: "processing",
                    processingStartedAt: new Date(),
                    reconciliationAttempts: 0,
                    lastReconciliationAttemptAt: new Date(),
                },
            },
            { new: true }
        );

        if (!claimed) {
            const refreshed = await Payment.findOne({ reference });
            try {
                await PaymentRecoveryAudit.create({
                    paymentReference: reference,
                    paymentId: payment._id,
                    initiatedBy: adminId,
                    outcome: "processing",
                    reason: "Claim failed — another request claimed the payment",
                    reconciliationAttemptsBefore: attemptsBefore,
                    reconciliationAttemptsAfter: refreshed ? (refreshed.reconciliationAttempts || 0) : attemptsBefore,
                });
            } catch (auditError) {
                paymentLogger.error("payment_recovery_audit_write_failed", {
                    event: "payment_recovery_audit_write_failed",
                    error: auditError.message,
                });
            }
            throw new PaymentError("Payment is currently being processed by another request", "processing");
        }

        // 5. Reuse existing reconciliation logic (skip claim since we already claimed).
        let result;
        let outcome = "error";
        let reason = null;
        try {
            result = await this.reconcilePayment(reference, correlationId, { skipClaim: true });
            outcome = result.success ? "success" : (result.status === "pending" ? "skipped" : "failed");
            reason = result.reason || null;
        } catch (error) {
            outcome = "error";
            reason = error.message;
            // Revert to pending on failure
            if (claimed.status === "processing") {
                claimed.status = "pending";
                claimed.processingStartedAt = null;
                await claimed.save();
            }
            throw error;
        } finally {
            // 6. Write audit record (failure-isolated).
            try {
                const updatedPayment = await Payment.findOne({ reference });
                await PaymentRecoveryAudit.create({
                    paymentReference: reference,
                    paymentId: payment._id,
                    initiatedBy: adminId,
                    outcome,
                    reason,
                    reconciliationAttemptsBefore: attemptsBefore,
                    reconciliationAttemptsAfter: updatedPayment ? (updatedPayment.reconciliationAttempts || 0) : 0,
                });
            } catch (auditError) {
                paymentLogger.error("payment_recovery_audit_write_failed", {
                    event: "payment_recovery_audit_write_failed",
                    error: auditError.message,
                });
            }
        }

        return result;
 
    }
 
    async verifyPayment(reference, userId, correlationId) {

        paymentLogger.setContext({ correlationId });

        try {

            // 1. Find the payment and associated booking FIRST (before reconciliation)
            //    so we can check ownership without modifying any state.
            const payment = await Payment.findOne({ reference });

            if (!payment) {
                throw new ApiError(404, "Payment not found");
            }

            const booking = await Booking.findById(payment.bookingId);

            if (!booking) {
                throw new ApiError(404, "Booking not found for this payment");
            }

            // 2. Authorization: only the booking client or consultant may verify payment
            const isClient = booking.clientId.toString() === userId.toString();
            const isConsultant = booking.consultantId.toString() === userId.toString();

            if (!isClient && !isConsultant) {
                throw new ApiError(
                    403,
                    "Not authorized to verify this payment"
                );
            }

            // 3. Now reconcile the payment (only if authorized)
            const result = await this.reconcilePayment(reference, correlationId);

            // Convert kobo to Naira for API response
            const displayPayment = {
                ...result.payment.toObject(),
                amount: koboToNaira(result.payment.amount),
            };

            if (result.success) {

                return {

                    success: true,

                    booking: result.booking,

                    meetingLink: result.meetingLink,

                    payment: displayPayment,

                    alreadyVerified: result.alreadyVerified,

                };

            } else {

                return {

                    success: false,

                    booking: result.booking,

                    payment: displayPayment,

                    reason: result.reason,

                    status: result.status,

                };

            }

        } catch (error) {

            paymentLogger.error("payment_verification_failed", {

                event: "payment_verification_failed",

                reference,

                error: error.message,

            });

            throw error;

        }

    }

    async handleWebhook(payload, signature, correlationId) {

        paymentLogger.setContext({ correlationId });

        // Verify Paystack webhook signature using timing-safe comparison.
        const secrets = this._getSecrets();
        let isValid = false;

        for (const secret of secrets) {

            const expectedHash = crypto
                .createHmac("sha512", secret)
                .update(payload)
                .digest("hex");

            const providedSignature = Buffer.from(signature, "hex");
            const expectedBuffer = Buffer.from(expectedHash, "hex");

            // Use timing-safe comparison to prevent timing attacks.
            if (providedSignature.length === expectedBuffer.length &&
                crypto.timingSafeEqual(providedSignature, expectedBuffer)) {

                isValid = true;

                break;

            }

        }

        if (!isValid) {

            paymentLogger.error("webhook_invalid_signature", {

                event: "webhook_invalid_signature",

            });

            throw new Error("Invalid webhook signature");

        }

        let eventData;

        try {

            eventData = JSON.parse(payload);

        } catch (error) {

            paymentLogger.error("webhook_invalid_payload", {

                event: "webhook_invalid_payload",

                error: error.message,

            });

            throw new Error("Invalid webhook payload");

        }

        const { event, data } = eventData;

        paymentLogger.info("payment_webhook_received", {

            event: "payment_webhook_received",

            paystackEvent: event,

            reference: data?.reference,

        });

        // Only process charge events through reconciliation.
        // reconcilePayment will verify with Paystack and apply all validations.
        if (event === "charge.success" || event === "charge.failed") {

            try {

                const result = await this.reconcilePayment(data.reference, correlationId);

                return {

                    statusCode: 200,

                    body: {

                        success: result.success,

                        booking: result.booking,

                        meetingLink: result.meetingLink,

                        alreadyVerified: result.alreadyVerified,

                    },

                };

            } catch (error) {

                // Map error types to appropriate HTTP status codes.
                if (error instanceof PaymentError) {

                    if (error.type === "integrity") {

                        paymentLogger.error("payment_webhook_integrity_failure", {

                            event: "payment_webhook_integrity_failure",

                            reference: data?.reference,

                            error: error.message,

                        });

                        return {

                            statusCode: 400,

                            body: {

                                success: false,

                                message: "Payment integrity check failed",

                            },

                        };

                    }

                    if (error.type === "not_found") {

                        paymentLogger.error("payment_webhook_not_found", {

                            event: "payment_webhook_not_found",

                            reference: data?.reference,

                        });

                        return {

                            statusCode: 404,

                            body: {

                                success: false,

                                message: "Payment or booking not found",

                            },

                        };

                    }

                }

                // Transient errors (Paystack API, database, network) → 500
                // Paystack will retry on 5xx.
                paymentLogger.error("payment_webhook_transient_error", {

                    event: "payment_webhook_transient_error",

                    reference: data?.reference,

                    error: error.message,

                });

                return {

                    statusCode: 500,

                    body: {

                        success: false,

                        message: "Temporary error during reconciliation",

                    },

                };

            }

        }

        return { statusCode: 200, body: { success: true } };

    }

    /**
     * Classify a Paystack transaction status as terminal failure or not.
     * Terminal failures are final and will not change to success.
     */
    _isTerminalPaystackStatus(status) {

        const terminalStatuses = ["failed", "abandoned"];

        return terminalStatuses.includes(status);

    }

    /**
     * Validate that Paystack reference matches our application reference.
     */
    _validateReferenceIntegrity(transaction, payment) {

        if (transaction.reference !== payment.reference) {

            paymentLogger.error("payment_integrity_failure", {

                event: "payment_integrity_failure",

                reference: payment.reference,

                errorType: "reference_mismatch",

                paystackReference: transaction.reference,

                appReference: payment.reference,

            });

            throw new PaymentError(
                `Reference integrity error: Paystack reference "${transaction.reference}" ` +
                `does not match application reference "${payment.reference}"`,
                "integrity"
            );

        }

    }

    /**
     * Validate that Paystack amount matches our payment amount.
     * Both values are kobo — strict equality, no conversion.
     */
    _validateAmountIntegrity(transaction, payment) {

        if (transaction.amount !== payment.amount) {

            paymentLogger.error("payment_integrity_failure", {

                event: "payment_integrity_failure",

                reference: payment.reference,

                errorType: "amount_mismatch",

                paystackAmount: transaction.amount,

                appAmount: payment.amount,

            });

            throw new PaymentError(
                `Amount integrity error: Paystack amount ${transaction.amount} kobo ` +
                `does not match payment amount ${payment.amount} kobo`,
                "integrity"
            );

        }

    }

    /**
     * Validate that both Paystack currency and payment currency are NGN.
     */
    _validateCurrencyIntegrity(transaction, payment) {

        const paystackCurrency = (transaction.currency || "").toUpperCase();

        if (paystackCurrency !== "NGN" || payment.currency !== "NGN") {

            paymentLogger.error("payment_integrity_failure", {

                event: "payment_integrity_failure",

                reference: payment.reference,

                errorType: "currency_mismatch",

                paystackCurrency,

                appCurrency: payment.currency,

            });

            throw new PaymentError(
                `Currency integrity error: Paystack currency "${paystackCurrency}" ` +
                `and payment currency "${payment.currency}" must both be NGN`,
                "integrity"
            );

        }

    }

    /**
     * Validate that the Payment belongs to the expected Booking.
     */
    _validateBookingIntegrity(payment, booking) {

        if (!payment.bookingId || !booking._id || payment.bookingId.toString() !== booking._id.toString()) {

            throw new PaymentError(
                "Booking integrity error: Payment does not match its associated booking",
                "integrity"
            );

        }

    }

    /**
     * Check whether another Payment for the same booking is already successful.
     * Returns the existing successful Payment document, or null.
     */
    async _checkDuplicateSuccessfulPayment(payment) {

        const existingSuccess = await Payment.findOne({
            bookingId: payment.bookingId,
            status: "success",
            _id: { $ne: payment._id },
        });

        return existingSuccess;

    }

    /**
     * Validate that the booking status transition is allowed.
     * Only pending bookings may be transitioned to confirmed.
     * Cancelled and completed bookings must not be silently re-opened.
     */
    _validateBookingStatusTransition(booking) {

        if (booking.status === "cancelled") {

            throw new PaymentError(
                "Cannot confirm a cancelled booking. The Paystack payment is preserved for refund/audit handling.",
                "integrity"
            );

        }

        if (booking.status === "completed") {

            throw new PaymentError(
                "Cannot confirm a completed booking. The Paystack payment is preserved for refund/audit handling.",
                "integrity"
            );

        }

        // pending → confirmed is valid.
        // already confirmed is also valid (no transition needed).

    }

    /**
     * Validate Paystack's paid_at timestamp.
     * Returns a valid Date, or current time as fallback.
     */
    _validatePaidAt(paidAtValue) {

        if (!paidAtValue) {

            return new Date();

        }

        const date = new Date(paidAtValue);

        if (isNaN(date.getTime())) {

            paymentLogger.warn("payment_invalid_paid_at", {

                event: "payment_invalid_paid_at",

                paidAtValue,

            });

            return new Date();

        }

        return date;

    }

    // NOTE: Refund processing has been moved to RefundService.
    // Use refundService.processRefund() or refundService.processRefundWithPaystack()
    // to ensure ConsultantEarning adjustment fields and refundHistory are updated.

    /**
     * Queue the payment-success emails for a settled booking.
     *
     * Delivery is asynchronous and owned by the email outbox worker. This
     * method is called AFTER the payment/booking transaction has committed,
     * so a queue failure can never reverse a successful payment.
     *
     * Dedupe keys are scoped to the payment reference and the recipient, so
     * re-processing the same settlement event (webhook replay, polling retry)
     * cannot create a second job, while a genuinely distinct payment produces
     * a distinct key.
     *
     * Consultant privacy: the consultant payload deliberately omits the
     * payment amount and reference. The outbox template registry also rejects
     * those keys for consultant templates, so the rule is enforced twice.
     */
    async _sendPaymentSuccessEmails(booking, meetingLink, reference) {

        try {

            const [client, consultant] = await Promise.all([

                User.findById(booking.clientId).select("firstName lastName email"),

                User.findById(booking.consultantId).select("firstName lastName email"),

            ]);

            if (!client || !consultant) {

                console.error("[Email] Could not find client or consultant for payment success notification");

                return;

            }

            const date = new Date(booking.date + 'T00:00:00').toLocaleDateString('en-US', {

                weekday: 'long',

                year: 'numeric',

                month: 'long',

                day: 'numeric',

            });

            const [hours, minutes] = booking.time.split(':');
            const timeDate = new Date();
            timeDate.setHours(parseInt(hours), parseInt(minutes));
            const time = timeDate.toLocaleTimeString('en-US', {

                hour: 'numeric',

                minute: '2-digit',

                hour12: true,

            });

            // booking.amount is in kobo; convert to Naira for display.
            const amount = (booking.amount / 100).toFixed(2);

            // Client email: full payment detail, including amount and reference.
            await this._enqueuePaymentEmail({

                recipient: client,

                templateId: EMAIL_TEMPLATE_ID.PAYMENT_SUCCESS,

                reference,

                templateData: {
                    clientName: client.firstName,
                    consultantName: `${consultant.firstName} ${consultant.lastName}`,
                    amount,
                    date,
                    time,
                    duration: booking.duration,
                    meetingLink,
                    reference,
                },

            });

            // Consultant email: no amount and no payment reference (privacy policy).
            await this._enqueuePaymentEmail({

                recipient: consultant,

                templateId: EMAIL_TEMPLATE_ID.PAYMENT_SUCCESS_CONSULTANT,

                reference,

                templateData: {
                    consultantName: consultant.firstName,
                    clientName: `${client.firstName} ${client.lastName}`,
                    date,
                    time,
                    duration: booking.duration,
                    meetingLink,
                },

            });

            paymentLogger.info("payment_success_emails_queued", {

                event: "payment_success_emails_queued",

                bookingId: booking._id.toString(),

            });

        } catch (error) {

            // The payment is already committed. A queue failure is logged for
            // operators and must never propagate to the payment caller.
            console.error(`[Email] Failed to queue payment success emails for booking ${booking._id}:`, error.message);

        }

    }

    /**
     * Persist the in-app notification for a successfully reconciled payment.
     *
     * Mirrors _sendPaymentFailureNotification: recipient is the client
     * (booking.clientId) — the business owner who paid. The consultant is
     * deliberately NOT notified in-app; the consultant still receives the
     * existing success email via _sendPaymentSuccessEmails.
     *
     * Emitted ONLY after the MongoDB transaction has committed the success
     * state, so this can never reverse a committed payment. Failure-isolated:
     * the domain emitter swallows any persistence failure and logs
     * `domain_notification_failed`, and a defensive guard logs
     * `payment_success_notification_emit_failed`.
     *
     * Dedupe key is derived by the emitter as
     * `payment.success:<clientId>:<bookingId>`, so webhook retries and
     * reconciliation re-runs cannot create duplicate notifications.
     *
     * @param {object} booking - Booking document (needs _id, clientId)
     * @param {object} payment - Payment document (needs _id)
     * @private
     */
    async _sendPaymentSuccessNotification(booking, payment) {
        if (!booking || !booking.clientId) {
            return;
        }

        try {
            await domainNotificationEmitter.emitToRecipients({
                category: NOTIFICATION_CATEGORY.PAYMENT,
                type: "payment.success",
                subjectId: booking._id.toString(),
                recipients: [
                    {
                        recipientId: booking.clientId,
                        title: "Payment successful",
                        body: "Your payment has been confirmed.",
                        data: {
                            bookingId: booking._id,
                            paymentId: payment._id,
                            deepLinkPath: "/dashboard/client/payments",
                        },
                    },
                ],
            });
        } catch (error) {
            // The domain emitter already swallows failures; this catch is a
            // defensive guard so a throw here can never escape the caller.
            paymentLogger.error("payment_success_notification_emit_failed", {
                event: "payment_success_notification_emit_failed",
                bookingId: booking?._id?.toString(),
                error: error?.message || error,
            });
        }
    }

    /**
     * Persist the in-app notification for a terminally failed payment.
     *
     * Recipient is the client (booking.clientId) — the business owner who
     * paid. The consultant is deliberately NOT notified in-app about a client's
     * failed payment; the consultant still receives the existing failure email
     * via _sendPaymentFailureEmails.
     *
     * Failure-isolated: the domain emitter swallows any persistence failure
     * and logs `domain_notification_failed`, so this can never reverse the
     * terminal payment state or block the failure emails.
     *
     * Dedupe key is stable per failed payment, so a webhook retry or a
     * reconciliation re-run cannot create a duplicate notification.
     *
     * @param {object} booking - Booking document (needs _id, clientId)
     * @param {object} payment - Payment document (needs _id)
     * @param {string} reference - application payment reference
     * @private
     */
    async _sendPaymentFailureNotification(booking, payment, reference) {
        if (!booking || !booking.clientId) {
            return;
        }

        try {
            await domainNotificationEmitter.emitToRecipients({
                category: NOTIFICATION_CATEGORY.PAYMENT,
                type: "payment.failed",
                subjectId: booking._id.toString(),
                recipients: [
                    {
                        recipientId: booking.clientId,
                        title: "Payment failed",
                        body: "We were unable to process your payment. Please review your payment details and try again.",
                        data: {
                            bookingId: booking._id,
                            paymentId: payment._id,
                            deepLinkPath: "/dashboard/client/payments",
                        },
                    },
                ],
            });
        } catch (error) {
            // The domain emitter already swallows failures; this catch is a
            // defensive guard so a throw here can never escape the caller.
            paymentLogger.error("payment_failure_notification_emit_failed", {
                event: "payment_failure_notification_emit_failed",
                bookingId: booking?._id?.toString(),
                error: error?.message || error,
            });
        }
    }

    /**
     * Queue the payment-failure emails for a terminally failed payment.
     *
     * Same contract as _sendPaymentSuccessEmails: asynchronous delivery, no
     * effect on payment state, recipient-scoped dedupe keys, and no amount or
     * reference in the consultant payload.
     */
    async _sendPaymentFailureEmails(booking, reference) {

        try {

            const [client, consultant] = await Promise.all([

                User.findById(booking.clientId).select("firstName lastName email"),

                User.findById(booking.consultantId).select("firstName lastName email"),

            ]);

            if (!client || !consultant) {

                console.error("[Email] Could not find client or consultant for payment failure notification");

                return;

            }

            const date = new Date(booking.date + 'T00:00:00').toLocaleDateString('en-US', {

                weekday: 'long',

                year: 'numeric',

                month: 'long',

                day: 'numeric',

            });

            const [hours, minutes] = booking.time.split(':');
            const timeDate = new Date();
            timeDate.setHours(parseInt(hours), parseInt(minutes));
            const time = timeDate.toLocaleTimeString('en-US', {

                hour: 'numeric',

                minute: '2-digit',

                hour12: true,

            });

            // booking.amount is in kobo; convert to Naira for display.
            const amount = (booking.amount / 100).toFixed(2);

            // Client email: full payment detail, including amount and reference.
            await this._enqueuePaymentEmail({

                recipient: client,

                templateId: EMAIL_TEMPLATE_ID.PAYMENT_FAILURE,

                reference,

                templateData: {
                    clientName: client.firstName,
                    consultantName: `${consultant.firstName} ${consultant.lastName}`,
                    amount,
                    date,
                    time,
                    reference,
                    reason: "Payment could not be processed. Please try again.",
                },

            });

            // Consultant email: no amount and no payment reference (privacy policy).
            await this._enqueuePaymentEmail({

                recipient: consultant,

                templateId: EMAIL_TEMPLATE_ID.PAYMENT_FAILURE_CONSULTANT,

                reference,

                templateData: {
                    consultantName: consultant.firstName,
                    clientName: `${client.firstName} ${client.lastName}`,
                    date,
                    time,
                    reason: "Client payment could not be processed.",
                },

            });

            paymentLogger.info("payment_failure_emails_queued", {

                event: "payment_failure_emails_queued",

                bookingId: booking._id.toString(),

            });

        } catch (error) {

            // The payment state is already persisted. A queue failure is
            // logged and must never propagate to the payment caller.
            console.error(`[Email] Failed to queue payment failure emails for booking ${booking._id}:`, error.message);

        }

    }

    /**
     * Enqueue a single payment email, isolating queue failures per recipient.
     *
     * Each recipient is queued independently so a failure for one does not
     * prevent the other from being queued. Only the recipient id and the
     * error message are logged — never the payload or rendered content.
     *
     * @private
     */
    async _enqueuePaymentEmail({ recipient, templateId, reference, templateData }) {

        try {

            await emailOutboxService.enqueue({

                recipientId: recipient._id,

                to: recipient.email,

                category: NOTIFICATION_CATEGORY.PAYMENT,

                templateId,

                templateData,

                // Stable, event- and recipient-specific: the same settlement
                // event re-processed for the same recipient resolves to the
                // same key and is deduplicated by the unique index.
                dedupeKey: `${templateId}:${recipient._id}:${reference}`,

            });

        } catch (error) {

            console.error(
                `[Email] Failed to queue ${templateId} email:`,
                {
                    recipientId: recipient._id.toString(),
                    error: error?.message || error,
                }
            );

        }

    }

    _getSecrets() {

        const primary = process.env.PAYSTACK_SECRET_KEY;

        const secondary = process.env.PAYSTACK_SECRET_KEY_OLD;

        if (!primary) {

            throw new Error("PAYSTACK_SECRET_KEY is not configured");

        }

        const secrets = [primary];

        if (secondary) {

            secrets.push(secondary);

        }

        return secrets;

    }

}

export { paystackClient };

export default new PaymentService();
