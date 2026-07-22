import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import bookingService from "../services/booking.service.js";

export const createBooking = asyncHandler(async (req, res) => {

    const booking = await bookingService.create(req.user._id, req.body);

    return res.status(201).json(
        new ApiResponse(
            201,
            booking,
            "Booking created successfully"
        )
    );

});

export const getMyBookings = asyncHandler(async (req, res) => {

    const { status, page, limit } = req.query;

    const result = await bookingService.findClientBookings(req.user._id, {
        status,
        page,
        limit,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Bookings fetched successfully"
        )
    );

});

export const getUpcomingBookings = asyncHandler(async (req, res) => {

    const bookings = await bookingService.findUpcomingBookings(req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            bookings,
            "Upcoming bookings fetched successfully"
        )
    );

});

export const getBookingById = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const booking = await bookingService.findById(id);

    if (!booking) {
        return res.status(404).json({
            success: false,
            message: "Booking not found",
        });
    }

    if (booking.clientId._id.toString() !== req.user._id.toString() &&
        booking.consultantId._id.toString() !== req.user._id.toString()) {
        return res.status(403).json({
            success: false,
            message: "Not authorized to view this booking",
        });
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            booking,
            "Booking fetched successfully"
        )
    );

});

export const cancelBooking = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const booking = await bookingService.cancel(id, req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            booking,
            "Booking cancelled successfully"
        )
    );

});

export const confirmBooking = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const booking = await bookingService.updateStatus(id, "confirmed");

    return res.status(200).json(
        new ApiResponse(
            200,
            booking,
            "Booking confirmed successfully"
        )
    );

});

export const completeBooking = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const booking = await bookingService.updateStatus(id, "completed");

    return res.status(200).json(
        new ApiResponse(
            200,
            booking,
            "Booking marked as completed"
        )
    );

});

export const getConsultantStats = asyncHandler(async (req, res) => {

    const stats = await bookingService.getStats(req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            stats,
            "Stats fetched successfully"
        )
    );

});

export const getAllBookings = asyncHandler(async (req, res) => {

    const { status, page, limit } = req.query;

    const result = await bookingService.findAll({
        status,
        page,
        limit,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "All bookings fetched successfully"
        )
    );

});
