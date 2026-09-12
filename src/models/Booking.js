import mongoose from "mongoose";

import { BOOKING_STATUS, CANCEL_ACTOR, REFUND_ELIGIBILITY } from "../utils/constants.js";

const bookingSchema = new mongoose.Schema(
    {
        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Client ID is required"],
        },

        consultantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Consultant ID is required"],
        },

        consultantProfileId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ConsultantProfile",
            required: [true, "Consultant profile ID is required"],
        },

        date: {
            type: String,
            required: [true, "Booking date is required"],
        },

        time: {
            type: String,
            required: [true, "Booking time is required"],
        },

        duration: {
            type: Number,
            required: [true, "Duration is required"],
            min: [1, "Duration must be at least 1 minute"],
        },

        /**
         * Booking amount in kobo (smallest NGN unit).
         * Calculated server-side from ConsultantProfile.hourlyRate × duration / 60.
         * @type {number} Integer kobo value (e.g., 2000000 = ₦20,000)
         */
        amount: {
            type: Number,
            required: [true, "Amount is required"],
            min: [0, "Amount cannot be negative"],
        },

        status: {
            type: String,
            enum: Object.values(BOOKING_STATUS),
            default: BOOKING_STATUS.PENDING,
        },

        meetingLink: {
            type: String,
            default: "",
        },

        googleEventId: {
            type: String,
            default: "",
        },

        googleConferenceId: {
            type: String,
            default: "",
        },

        notes: {
            type: String,
            maxlength: [500, "Notes cannot exceed 500 characters"],
            default: "",
        },

        paymentReference: {
            type: String,
            default: "",
        },

        paymentStatus: {
            type: String,
            enum: ["pending", "paid", "failed", "refunded"],
            default: "pending",
        },

        paymentMethod: {
            type: String,
            default: "paystack",
        },

        paidAt: {
            type: Date,
            default: null,
        },

        refundStatus: {
            type: String,
            enum: ["none", "pending", "completed", "failed"],
            default: "none",
        },

        refundedAt: {
            type: Date,
            default: null,
        },

        cancelledAt: {
            type: Date,
            default: null,
        },

        cancelledBy: {
            type: String,
            enum: ["client", "consultant", "admin"],
            default: null,
        },

        /**
         * Reason provided by the cancelling party.
         * Required when cancelling a booking.
         */
        cancellationReason: {
            type: String,
            maxlength: [500, "Cancellation reason cannot exceed 500 characters"],
            default: "",
        },

        /**
         * Refund eligibility based on cancellation timing.
         * - "full" → cancelled ≥36 hours before session
         * - "none" → cancelled <36 hours before session
         */
        refundEligibility: {
            type: String,
            enum: Object.values(REFUND_ELIGIBILITY),
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

const Booking = mongoose.model("Booking", bookingSchema);

export default Booking;
