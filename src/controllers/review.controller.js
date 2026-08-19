import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import ApiError from "../utils/ApiError.js";

import Review from "../models/Review.js";
import Booking from "../models/Booking.js";
import ConsultantProfile from "../models/ConsultantProfile.js";

export const createReview = asyncHandler(async (req, res) => {

    const { bookingId, rating, comment } = req.body;

    const booking = await Booking.findById(bookingId);

    if (!booking) {
        throw new ApiError(404, "Booking not found");
    }

    if (booking.status !== "completed") {
        throw new ApiError(400, "You can only review completed bookings");
    }

    if (booking.clientId.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "You can only review your own bookings");
    }

    // Check if review already exists
    const existingReview = await Review.findOne({ bookingId });
    if (existingReview) {
        throw new ApiError(400, "You have already reviewed this booking");
    }

    const review = await Review.create({
        bookingId,
        clientId: req.user._id,
        consultantId: booking.consultantId,
        rating,
        comment: comment || "",
    });

    // Update consultant profile rating
    await updateConsultantRating(booking.consultantId);

    return res.status(201).json(
        new ApiResponse(
            201,
            review,
            "Review submitted successfully"
        )
    );

});

export const getConsultantReviews = asyncHandler(async (req, res) => {

    const { consultantId } = req.params;
    const { page, limit } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [reviews, total] = await Promise.all([

        Review.find({ consultantId, isVisible: true })
            .populate("clientId", "firstName lastName")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum),

        Review.countDocuments({ consultantId, isVisible: true }),

    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                reviews,
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum),
            },
            "Reviews fetched successfully"
        )
    );

});

export const getMyReviews = asyncHandler(async (req, res) => {

    const { page, limit } = req.query;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;
    const skip = (pageNum - 1) * limitNum;

    const [reviews, total] = await Promise.all([

        Review.find({ clientId: req.user._id })
            .populate("consultantId", "firstName lastName")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limitNum),

        Review.countDocuments({ clientId: req.user._id }),

    ]);

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                reviews,
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum),
            },
            "My reviews fetched successfully"
        )
    );

});

// Helper function to update consultant rating
async function updateConsultantRating(consultantId) {

    const result = await Review.aggregate([

        { $match: { consultantId: new (await import("mongoose")).default.Types.ObjectId(consultantId), isVisible: true } },

        {
            $group: {
                _id: null,
                averageRating: { $avg: "$rating" },
                reviewCount: { $sum: 1 },
            },
        },

    ]);

    const profile = await ConsultantProfile.findOne({ userId: consultantId });

    if (profile) {

        if (result.length > 0) {

            profile.rating = Math.round(result[0].averageRating * 10) / 10;
            profile.reviewCount = result[0].reviewCount;

        } else {

            profile.rating = 0;
            profile.reviewCount = 0;

        }

        await profile.save();

    }

}
