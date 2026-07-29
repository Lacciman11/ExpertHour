import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import paymentService from "../services/payment.service.js";
import bookingService from "../services/booking.service.js";

export const initializePayment = asyncHandler(async (req, res) => {

    const { bookingId, amount, email } = req.body;

    const result = await paymentService.initializePayment(bookingId, amount, email, req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Payment initialized successfully"
        )
    );

});

export const verifyPayment = asyncHandler(async (req, res) => {

    const { reference } = req.params;

    const result = await paymentService.verifyPayment(reference);

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Payment verified successfully"
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

    await paymentService.handleWebhook(req.body);

    return res.status(200).json({ success: true });

});
