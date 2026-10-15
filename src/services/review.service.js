import mongoose from "mongoose";

import Review from "../models/Review.js";
import Booking from "../models/Booking.js";
import ConsultantProfile from "../models/ConsultantProfile.js";
import ConsultationSession from "../models/ConsultationSession.js";
import User from "../models/User.js";
import paymentLogger from "../utils/logger.js";
import { SESSION_OUTCOME, NOTIFICATION_CATEGORY, EMAIL_TEMPLATE_ID } from "../utils/constants.js";
import domainNotificationEmitter from "./domain-notification.emitter.js";
import emailOutboxService from "./email-outbox.service.js";

class ReviewService {

    /**
     * Enqueue a review-received email to the consultant via the durable email
     * outbox. Non-critical post-commit side effect: the account lookup and
     * enqueue are fully isolated so a failure can never reverse the committed
     * review or suppress the in-app notification.
     *
     * Privacy: the recipient is the consultant's User id and the destination is
     * User.email — never a profile id or googleEmail. The payload carries only
     * firstName (no rating, review text, or client identity). Only safe
     * identifiers and error.message are logged.
     *
     * @param {string|object} consultantUserId - the consultant's User id
     * @param {string|object} reviewId - the review id (dedupe subject)
     * @private
     */
    async _enqueueReviewReceivedEmail(consultantUserId, reviewId) {
        try {
            const user = await User.findById(consultantUserId);

            if (!user || !user.email) {
                return;
            }

            await emailOutboxService.enqueue({
                recipientId: consultantUserId,
                to: user.email,
                category: NOTIFICATION_CATEGORY.REVIEW,
                templateId: EMAIL_TEMPLATE_ID.REVIEW_RECEIVED,
                templateData: { firstName: user.firstName },
                dedupeKey: emailOutboxService.buildDedupeKey(
                    EMAIL_TEMPLATE_ID.REVIEW_RECEIVED,
                    consultantUserId.toString(),
                    reviewId.toString()
                ),
            });
        } catch (error) {
            paymentLogger.error("review_received_email_enqueue_failed", {
                event: "review_received_email_enqueue_failed",
                reviewId: reviewId.toString(),
                error: error?.message || error,
            });
        }
    }

    async createReview(clientId, data) {

        const { bookingId, rating, comment } = data;

        const booking = await Booking.findById(bookingId);

        if (!booking) {

            throw new Error("Booking not found");

        }

        if (booking.clientId.toString() !== clientId.toString()) {

            throw new Error("Not authorized to review this booking");

        }

        // Review eligibility is based on the actual consultation outcome,
        // not Booking.status. The outcome worker finalizes the session result
        // independently of the booking lifecycle state.
        const session = await ConsultationSession.findOne({ bookingId }).select("outcome");

        if (!session || session.outcome !== SESSION_OUTCOME.COMPLETED) {

            throw new Error("Can only review completed sessions");

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

        // Notify the consultant. Emitted only after the review exists and the
        // rating update has completed, so a failed review never notifies.
        // The body deliberately omits the rating value and the client's
        // identity — only the review reference is exposed.
        await domainNotificationEmitter.emitToRecipients({
            category: NOTIFICATION_CATEGORY.REVIEW,
            type: "review.received",
            subjectId: review._id.toString(),
            recipients: [
                {
                    recipientId: booking.consultantId,
                    title: "New review received",
                    body: "You have received a new review for a completed session.",
                    data: {
                        reviewId: review._id,
                        bookingId: booking._id,
                        deepLinkPath: "/dashboard/consultant/reviews",
                    },
                },
            ],
        });

        // Post-commit, post-in-app side effect: email the consultant. Fully
        // isolated; cannot reverse the committed review or suppress the in-app
        // notification above. The payload carries no rating, review text, or
        // client identity.
        await this._enqueueReviewReceivedEmail(booking.consultantId, review._id);

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
