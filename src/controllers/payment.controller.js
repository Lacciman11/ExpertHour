import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import ApiError from "../utils/ApiError.js";

import paymentService from "../services/payment.service.js";
import { selectPaystackRefundId } from "../services/refund.service.js";
import bookingService from "../services/booking.service.js";
import refundService from "../services/refund.service.js";
import Payment from "../models/Payment.js";
import { ADJUSTMENT_REASON } from "../utils/constants.js";

export const initializePayment = asyncHandler(async (req, res) => {

    const correlationId = req.correlationId || req.id;

    const { bookingId } = req.body;

    const result = await paymentService.initializePayment(bookingId, req.user._id, correlationId);

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Payment initialized successfully"
        )
    );

});

export const verifyPayment = asyncHandler(async (req, res) => {

    const correlationId = req.correlationId || req.id;

    const { reference } = req.params;

    // Service layer enforces payment ownership (booking client or consultant)
    const result = await paymentService.verifyPayment(reference, req.user._id, correlationId);

    if (result.success && result.booking) {

        // Redirect to payment success page with booking ID
        const successUrl = `/booking/payment-success?reference=${reference}&bookingId=${result.booking._id}`;

        return res.status(200).json(
            new ApiResponse(
                200,
                { ...result, redirectUrl: successUrl },
                "Payment verified successfully"
            )
        );

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Payment verification completed"
        )
    );

});

export const generateMeetingLink = asyncHandler(async (req, res) => {

    const { bookingId } = req.body;

    // Service layer enforces booking ownership (client or consultant)
    const booking = await bookingService.generateMeetingLink(bookingId, req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            { meetingLink: booking.meetingLink },
            "Meeting link generated successfully"
        )
    );

});

export const handleWebhook = asyncHandler(async (req, res) => {

    const correlationId = req.correlationId || req.id;

    const signature = req.headers["x-paystack-signature"];

    if (!signature) {

        return res.status(400).json({ success: false, message: "Missing signature" });

    }

    // Use raw body for HMAC verification if available, otherwise fall back to parsed body.
    // The raw body is captured by the middleware in app.js for webhook paths.
    const payload = req.rawBody || JSON.stringify(req.body);

    const result = await paymentService.handleWebhook(payload, signature, correlationId);

    return res.status(result.statusCode).json(result.body);

});

export const retryPayment = asyncHandler(async (req, res) => {

    const { bookingId } = req.params;

    const correlationId = req.correlationId || req.id;

    const result = await paymentService.retryPayment(bookingId, req.user._id, correlationId);

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Payment retry initialized successfully"
        )
    );

});

export const initiateRefund = asyncHandler(async (req, res) => {

    const { paymentId } = req.params;
    const { amount, reason, notes, refundReference } = req.body;

    // Fetch payment to obtain bookingId and validate existence
    const payment = await Payment.findById(paymentId);

    if (!payment) {

        return res.status(404).json({

            success: false,

            message: "Payment not found",

        });

    }

    // Convert amount to kobo.
    // The existing API accepted amount in Naira; preserve that behavior
    // while also supporting direct kobo input via refundAmount.
    let refundAmount;

    if (amount !== undefined && amount !== null) {

        refundAmount = Math.round(Number(amount) * 100);

    } else if (req.body.refundAmount !== undefined && req.body.refundAmount !== null) {

        refundAmount = Number(req.body.refundAmount);

    } else {

        return res.status(400).json({

            success: false,

            message: "Refund amount is required",

        });

    }

    if (refundAmount <= 0) {

        return res.status(400).json({

            success: false,

            message: "Refund amount must be positive",

        });

    }

    // Determine refund reason if not provided
    let finalReason = reason;

    if (!finalReason) {

        finalReason = refundAmount >= payment.amount

            ? ADJUSTMENT_REASON.FULL_REFUND

            : ADJUSTMENT_REASON.PARTIAL_REFUND;

    }

    // Generate a refundReference if the caller did not supply one
    const finalRefundReference = refundReference && refundReference.trim() !== ""

        ? refundReference.trim()

        : `REF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    try {

        const result = await refundService.processRefundWithPaystack({

            paymentId,

            bookingId: payment.bookingId,

            refundReference: finalRefundReference,

            refundAmount,

            reason: finalReason,

            adminId: req.user._id,

            notes: notes || null,

        });

        return res.status(200).json(

            new ApiResponse(

                200,

                result,

                "Refund initiated successfully"

            )

        );

    } catch (error) {

        if (error instanceof ApiError) {

            return res.status(error.statusCode).json({

                success: false,

                message: error.message,

            });

        }

        throw error;

    }

});

export const checkRefundStatus = asyncHandler(async (req, res) => {

    const { paymentId } = req.params;

    try {

        const history = await refundService.getRefundHistory(paymentId);

        // Attempt to fetch latest Paystack refund status for visibility
        let paystackStatus = null;
        let paystackError = null;

        try {

            const payment = await Payment.findById(paymentId);

            // Use the Paystack-native refund id (from refundResponse), not the
            // local REF-* idempotency key. Calling Paystack with the local
            // reference would never resolve to the actual refund.
            const paystackRefundId = payment ? selectPaystackRefundId(payment) : null;

            if (payment && paystackRefundId !== null && paystackRefundId !== undefined) {

                const response = await paymentService.paystackClient.request(

                    "GET",

                    `/refund/${paystackRefundId}`

                );

                paystackStatus = response.data;

            } else if (payment && payment.refundReference) {

                // Refund record exists but Paystack-native id is missing
                // (legacy / pre-fix record). Do not call Paystack with the
                // local REF-* value; surface a clear error instead.
                paystackError =
                    "Paystack-native refund id unavailable; cannot query Paystack with the local refund reference.";

            }

        } catch (err) {

            // Paystack check is best-effort; local history remains authoritative
            paystackError = err.message;

        }

        return res.status(200).json(
            new ApiResponse(
                200,
                { history, paystackStatus, paystackError },
                "Refund status fetched successfully"
            )
        );

    } catch (error) {

        if (error instanceof ApiError) {

            return res.status(error.statusCode).json({

                success: false,

                message: error.message,

            });

        }

        throw error;

    }

});

/**
 * Reconcile a Paystack refund when the external refund succeeded but the
 * local MongoDB transaction failed to commit.
 *
 * This endpoint triggers the same reconciliation logic that the background
 * RefundReconciliationService worker uses. It is idempotent — repeated
 * reconciliation of the same refund will not double-adjust earnings or
 * duplicate refund history.
 *
 * Admin-only.
 */
export const reconcileRefund = asyncHandler(async (req, res) => {

    const { paymentId } = req.params;

    try {

        const result = await refundService.reconcileRefundWithPaystack(paymentId);

        return res.status(200).json(

            new ApiResponse(

                200,

                result,

                result.reconciled

                    ? "Refund reconciled successfully"

                    : "Refund reconciliation completed",

            )

        );

    } catch (error) {

        if (error instanceof ApiError) {

            return res.status(error.statusCode).json({

                success: false,

                message: error.message,

            });

        }

        throw error;

    }

});
