import mongoose from "mongoose";

const consultationSessionSchema = new mongoose.Schema(
    {
        bookingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Booking",
            required: [true, "Booking ID is required"],
            unique: true,
        },

        consultantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Consultant ID is required"],
        },

        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Client ID is required"],
        },

        notes: {
            type: String,
            maxlength: [2000, "Session notes cannot exceed 2000 characters"],
            default: "",
        },

        recordingUrl: {
            type: String,
            default: "",
        },

        attendanceStatus: {
            type: String,
            enum: ["not_started", "in_progress", "completed", "no_show_client", "no_show_consultant", "late_client", "late_consultant"],
            default: "not_started",
        },

        startedAt: {
            type: Date,
            default: null,
        },

        endedAt: {
            type: Date,
            default: null,
        },

        clientJoinedAt: {
            type: Date,
            default: null,
        },

        consultantJoinedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

consultationSessionSchema.index({ consultantId: 1 });
consultationSessionSchema.index({ clientId: 1 });

const ConsultationSession = mongoose.model("ConsultationSession", consultationSessionSchema);

export default ConsultationSession;
