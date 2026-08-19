import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import paymentService from "../services/payment.service.js";
import bookingService from "../services/booking.service.js";

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
    const { amount } = req.body;

    const result = await paymentService.initiateRefund(paymentId, amount, req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Refund initiated successfully"
        )
    );

});

export const checkRefundStatus = asyncHandler(async (req, res) => {

    const { paymentId } = req.params;

    const result = await paymentService.checkRefundStatus(paymentId);

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Refund status checked successfully"
        )
    );

});
