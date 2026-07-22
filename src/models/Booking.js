import mongoose from "mongoose";

import { BOOKING_STATUS } from "../utils/constants.js";

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
            min: [1, "Duration must be at least 1 hour"],
        },

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

        notes: {
            type: String,
            maxlength: [500, "Notes cannot exceed 500 characters"],
            default: "",
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

const Booking = mongoose.model("Booking", bookingSchema);

export default Booking;
