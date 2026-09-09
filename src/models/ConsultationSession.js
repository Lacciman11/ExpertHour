import mongoose from "mongoose";

import { SESSION_OUTCOME } from "../utils/constants.js";

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
         * Timestamps and durationSeconds are assigned by the server.
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
         * Server-derived scheduled session window (Africa/Lagos wall-clock
         * interpreted into absolute UTC instants). Populated from the
         * associated Booking at session creation time. NEVER settable from
         * participant input.
         */
        scheduledStart: {
            type: Date,
            default: null,
        },
        scheduledEnd: {
            type: Date,
            default: null,
        },
        consultantGraceEnd: {
            type: Date,
            default: null,
        },
        clientWaitEnd: {
            type: Date,
            default: null,
        },

        /**
         * Server-derived required attendance duration in seconds for the
         * 80% threshold (computed from Booking.duration).
         * requiredDurationSeconds = floor(Booking.duration * 60 * 80 / 100).
         */
        requiredDurationSeconds: {
            type: Number,
            default: null,
            min: [0, "Required duration cannot be negative"],
        },

        /**
         * Cumulative attendance duration for client in seconds.
         * Calculated from attendanceEvents, clamped to the scheduled window.
         * SERVER-DERIVED; never settable from participant input.
         */
        clientAttendanceDuration: {
            type: Number,
            default: 0,
            min: [0, "Duration cannot be negative"],
        },

        /**
         * Cumulative attendance duration for consultant in seconds.
         * SERVER-DERIVED.
         */
        consultantAttendanceDuration: {
            type: Number,
            default: 0,
            min: [0, "Duration cannot be negative"],
        },

        /**
         * Whether client met the 80% attendance requirement.
         * null = not yet determined, true = met, false = not met.
         * SERVER-DERIVED.
         */
        clientAttendanceMet: {
            type: Boolean,
            default: null,
        },

        /**
         * Whether consultant met the 80% attendance requirement.
         * null = not yet determined, true = met, false = not met.
         * SERVER-DERIVED.
         */
        consultantAttendanceMet: {
            type: Boolean,
            default: null,
        },

        /**
         * Timestamp of the most recent server reconciliation. Useful for
         * the future outcome worker to detect stale state and to make
         * duration / met-flag calculations idempotent.
         */
        lastReconciledAt: {
            type: Date,
            default: null,
        },

        /**
         * Terminal session outcome. SERVER-DETERMINED by the outcome
         * worker using only trusted server data (scheduled window,
         * attendanceEvents, booking cancellation state). NEVER settable
         * by participants. Once set, this field is immutable through
         * normal APIs — the atomic `findOneAndUpdate` in the worker
         * uses `outcome: null` as a guard.
         *
         * null = not yet finalized (still being recorded / reconciled).
         */
        outcome: {
            type: String,
            enum: Object.values(SESSION_OUTCOME),
            default: null,
            index: true,
        },

        /**
         * Server timestamp when the terminal outcome was finalized.
         * Set atomically alongside `outcome` by the outcome worker.
         */
        outcomeFinalizedAt: {
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
consultationSessionSchema.index({ bookingId: 1, "attendanceEvents.participant": 1 });

const ConsultationSession = mongoose.model("ConsultationSession", consultationSessionSchema);

export default ConsultationSession;
