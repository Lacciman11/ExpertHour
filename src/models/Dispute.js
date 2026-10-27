import mongoose from "mongoose";

import { DISPUTE_RESOLUTION, USER_ROLES } from "../utils/constants.js";

const disputeSchema = new mongoose.Schema(
    {
        bookingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Booking",
            required: [true, "Booking ID is required"],
        },
        paymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            default: null,
        },
        earningId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ConsultantEarning",
            default: null,
        },
        openedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Opened by user is required"],
        },
        openedByRole: {
            type: String,
            enum: [USER_ROLES.BUSINESS_OWNER, USER_ROLES.CONSULTANT, USER_ROLES.ADMIN],
            required: [true, "Opened by role is required"],
        },
        reason: {
            type: String,
            enum: ["service_not_rendered", "quality_issue", "no_show", "billing_error", "other"],
            required: [true, "Dispute reason is required"],
        },
        status: {
            type: String,
            enum: ["OPEN", "UNDER_REVIEW", "RESOLVED", "CLOSED"],
            default: "OPEN",
        },
        resolution: {
            type: String,
            enum: [null, ...Object.values(DISPUTE_RESOLUTION)],
            default: null,
        },
        resolutionNotes: {
            type: String,
            default: null,
        },
        resolutionAmount: {
            type: Number,
            default: null,
            min: [0, "Resolution amount cannot be negative"],
        },
        resolvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        resolvedAt: {
            type: Date,
            default: null,
        },
        financialStatus: {
            type: String,
            enum: ["none", "pending", "processing", "completed", "failed", "awaiting_reconciliation"],
            default: "none",
        },
        financialReference: {
            type: String,
            default: null,
        },
        financialError: {
            type: String,
            default: null,
        },
        financialProcessedAt: {
            type: Date,
            default: null,
        },
        financialAttempts: {
            type: Number,
            default: 0,
            min: [0, "Financial attempts cannot be negative"],
        },
        financialClaimedAt: {
            type: Date,
            default: null,
        },
        financialLeaseExpiresAt: {
            type: Date,
            default: null,
        },
        financialClaimId: {
            type: String,
            default: null,
        },
    },
    { timestamps: true }
);

disputeSchema.index({ bookingId: 1 }, { unique: true });
disputeSchema.index({ status: 1 });

export default mongoose.model("Dispute", disputeSchema);