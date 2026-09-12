import axios from "axios";
import crypto from "crypto";
import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import User from "../models/User.js";
import googleCalendarService from "./google-calendar.service.js";
import {
    emailService,
    paymentSuccessTemplate,
    paymentFailureTemplate,
    paymentSuccessConsultantTemplate,
    paymentFailureConsultantTemplate,
} from "./email/index.js";
import { koboToNaira } from "../utils/currency.js";
import paymentLogger from "../utils/logger.js";
import ApiError from "../utils/ApiError.js";

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
    async reconcilePayment(reference, correlationId) {

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
        if (payment.status === "processing") {

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

                // Only transition booking to confirmed if it is currently pending.
                // Cancelled and completed bookings must not be silently re-opened.
                if (booking.status === "pending") {

                    booking.status = "confirmed";

                }

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
            let meetingLink = booking.meetingLink;
            let calendarResult = null;

            try {

                calendarResult = await googleCalendarService.createEventAndGetMeetLink(
                    booking._id,
                    booking.date,
                    booking.time,
                    booking.duration,
                    booking.consultantId,
                    booking.clientId
                );

                // Support both legacy string return and new object return.
                if (typeof calendarResult === "string") {
                    meetingLink = calendarResult;
                } else if (calendarResult && typeof calendarResult === "object") {
                    meetingLink = calendarResult.meetingLink || meetingLink;
                }

                // Only update booking if something changed to avoid unnecessary writes.
                const needsUpdate =
                    (meetingLink && meetingLink !== booking.meetingLink) ||
                    (calendarResult?.googleEventId && calendarResult.googleEventId !== booking.googleEventId) ||
                    (calendarResult?.googleConferenceId && calendarResult.googleConferenceId !== booking.googleConferenceId);

                if (needsUpdate) {
                    if (meetingLink) {
                        booking.meetingLink = meetingLink;
                    }
                    if (calendarResult?.googleEventId) {
                        booking.googleEventId = calendarResult.googleEventId;
                    }
                    if (calendarResult?.googleConferenceId) {
                        booking.googleConferenceId = calendarResult.googleConferenceId;
                    }
                    await booking.save();
                }

            } catch (calendarError) {

                paymentLogger.error("google_calendar_event_failed", {

                    event: "google_calendar_event_failed",

                    bookingId: booking._id.toString(),

                    error: calendarError.message,

                });

            }

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

            // Send email to client
            // booking.amount is in kobo; convert to Naira for display
            const clientHtml = paymentSuccessTemplate({

                clientName: client.firstName,

                consultantName: `${consultant.firstName} ${consultant.lastName}`,

                amount: (booking.amount / 100).toFixed(2),

                date,

                time,

                duration: booking.duration,

                meetingLink,

                reference,

            });

            await emailService.send({

                to: client.email,

                subject: "Payment Successful - Your Session is Confirmed",

                html: clientHtml,

            });

            // Send email to consultant (no amount or payment reference per privacy policy)
            const consultantHtml = paymentSuccessConsultantTemplate({

                clientName: `${client.firstName} ${client.lastName}`,

                consultantName: consultant.firstName,

                date,

                time,

                duration: booking.duration,

                meetingLink,

            });

            await emailService.send({

                to: consultant.email,

                subject: "New Booking Confirmed - Payment Received",

                html: consultantHtml,

            });

            paymentLogger.info("payment_success_emails_sent", {

                event: "payment_success_emails_sent",

                bookingId: booking._id.toString(),

            });

        } catch (error) {

            console.error(`[Email] Failed to send payment success emails for booking ${booking._id}:`, error.message);

        }

    }

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

            // Send email to client
            // booking.amount is in kobo; convert to Naira for display
            const clientHtml = paymentFailureTemplate({

                clientName: client.firstName,

                consultantName: `${consultant.firstName} ${consultant.lastName}`,

                amount: (booking.amount / 100).toFixed(2),

                date,

                time,

                reference,

                reason: "Payment could not be processed. Please try again.",

            });

            await emailService.send({

                to: client.email,

                subject: "Payment Failed - Action Required",

                html: clientHtml,

            });

            // Send email to consultant (no amount or payment reference per privacy policy)
            const consultantHtml = paymentFailureConsultantTemplate({

                clientName: `${client.firstName} ${client.lastName}`,

                consultantName: consultant.firstName,

                date,

                time,

                reason: "Client payment could not be processed.",

            });

            await emailService.send({

                to: consultant.email,

                subject: "Booking Payment Failed",

                html: consultantHtml,

            });

            paymentLogger.info("payment_failure_emails_sent", {

                event: "payment_failure_emails_sent",

                bookingId: booking._id.toString(),

            });

        } catch (error) {

            console.error(`[Email] Failed to send payment failure emails for booking ${booking._id}:`, error.message);

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
