import mongoose from "mongoose";

import Review from "../models/Review.js";
import Booking from "../models/Booking.js";
import ConsultantProfile from "../models/ConsultantProfile.js";

class ReviewService {

    async createReview(clientId, data) {

        const { bookingId, rating, comment } = data;

        const booking = await Booking.findById(bookingId);

        if (!booking) {

            throw new Error("Booking not found");

        }

        if (booking.clientId.toString() !== clientId.toString()) {

            throw new Error("Not authorized to review this booking");

        }

        if (booking.status !== "completed") {

            throw new Error("Can only review completed bookings");

        }

        // Check if review already exists for this booking
        const existingReview = await Review.findOne({ bookingId });

        if (existingReview) {

            throw new Error("Review already submitted for this booking");

        }

        const review = await Review.create({

            bookingId,

            clientId: booking.clientId,

            consultantId: booking.consultantId,

            rating,

            comment,

        });

        // Update consultant profile rating
        await this._updateConsultantRating(booking.consultantId);

        return review;

    }

    async getConsultantReviews(consultantId, filters = {}) {

        const query = { consultantId, isVisible: true };

        const page = parseInt(filters.page) || 1;

        const limit = parseInt(filters.limit) || 10;

        const skip = (page - 1) * limit;

        const [reviews, total] = await Promise.all([

            Review.find(query)
                .populate("clientId", "firstName lastName")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),

            Review.countDocuments(query),

        ]);

        return {

            reviews,

            total,

            page,

            limit,

            totalPages: Math.ceil(total / limit),

        };

    }

    async getBookingReview(bookingId) {

        const review = await Review.findOne({ bookingId })
            .populate("clientId", "firstName lastName")
            .populate("consultantId", "firstName lastName");

        return review;

    }

    async _updateConsultantRating(consultantId) {

        const result = await Review.aggregate([

            { $match: { consultantId: new mongoose.Types.ObjectId(consultantId), isVisible: true } },

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

}

export default new ReviewService();
