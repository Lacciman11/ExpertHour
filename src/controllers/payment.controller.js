import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import ApiError from "../utils/ApiError.js";

import paymentService from "../services/payment.service.js";
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

    const result = await paymentService.verifyPayment(reference, correlationId);

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

    const booking = await bookingService.generateMeetingLink(bookingId);

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

    const result = await paymentService.retryPayment(bookingId, req.user._id);

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

        try {

            const payment = await Payment.findById(paymentId);

            if (payment && payment.refundReference) {

                const response = await paymentService.paystackClient.request(

                    "GET",

                    `/refund/${payment.refundReference}`

                );

                paystackStatus = response.data;

            }

        } catch (paystackError) {

            // Paystack check is best-effort; local history remains authoritative
            paystackStatus = { error: paystackError.message };

        }

        return res.status(200).json(

            new ApiResponse(

                200,

                { history, paystackStatus },

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
