import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
    {
        bookingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Booking",
            required: [true, "Booking ID is required"],
            unique: true,
        },

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

        rating: {
            type: Number,
            required: [true, "Rating is required"],
            min: [1, "Rating must be at least 1"],
            max: [5, "Rating cannot exceed 5"],
        },

        comment: {
            type: String,
            required: [true, "Comment is required"],
            maxlength: [1000, "Comment cannot exceed 1000 characters"],
        },

        isVisible: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

reviewSchema.index({ consultantId: 1 });
reviewSchema.index({ clientId: 1 });

const Review = mongoose.model("Review", reviewSchema);

export default Review;
