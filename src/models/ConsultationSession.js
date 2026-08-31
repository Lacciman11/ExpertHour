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

        /**
         * Attendance events tracking for join/leave history.
         * Supports multiple join/leave periods per participant.
         */
        attendanceEvents: [
            {
                participant: {
                    type: String,
                    enum: ["client", "consultant"],
                    required: [true, "Participant is required"],
                },
                joinedAt: {
                    type: Date,
                    required: [true, "Join timestamp is required"],
                },
                leftAt: {
                    type: Date,
                    default: null,
                },
                durationSeconds: {
                    type: Number,
                    default: 0,
                    min: [0, "Duration cannot be negative"],
                },
            },
        ],

        /**
         * Cumulative attendance duration for client in seconds.
         * Calculated from attendanceEvents.
         */
        clientAttendanceDuration: {
            type: Number,
            default: 0,
            min: [0, "Duration cannot be negative"],
        },

        /**
         * Cumulative attendance duration for consultant in seconds.
         * Calculated from attendanceEvents.
         */
        consultantAttendanceDuration: {
            type: Number,
            default: 0,
            min: [0, "Duration cannot be negative"],
        },

        /**
         * Whether client met the 80% attendance requirement.
         * null = not yet determined, true = met, false = not met.
         */
        clientAttendanceMet: {
            type: Boolean,
            default: null,
        },

        /**
         * Whether consultant met the 80% attendance requirement.
         * null = not yet determined, true = met, false = not met.
         */
        consultantAttendanceMet: {
            type: Boolean,
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
