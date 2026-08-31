import mongoose from "mongoose";

import {
    PAYOUT_STATUS,
    MINIMUM_PAYOUT_KOBO,
} from "../utils/constants.js";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const earningReferenceSchema = new mongoose.Schema(
    {
        earningId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ConsultantEarning",
            required: [true, "Earning ID is required"],
        },
        grossAmount: {
            type: Number,
            required: [true, "Gross amount is required"],
            min: [0, "Gross amount cannot be negative"],
        },
        platformCommission: {
            type: Number,
            required: [true, "Platform commission is required"],
            min: [0, "Platform commission cannot be negative"],
        },
        consultantAmount: {
            type: Number,
            required: [true, "Consultant amount is required"],
            min: [0, "Consultant amount cannot be negative"],
        },
    },
    { _id: false }
);

const statusHistoryEventSchema = new mongoose.Schema(
    {
        from: String,
        to: {
            type: String,
            enum: Object.values(PAYOUT_STATUS),
            required: [true, "Target status is required"],
        },
        changedAt: {
            type: Date,
            default: Date.now,
        },
        changedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
        reason: String,
    },
    { _id: false }
);

// ---------------------------------------------------------------------------
// Main Schema
// ---------------------------------------------------------------------------

const payoutSchema = new mongoose.Schema(
    {
        // === Consultant Reference ===
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

        // === Payout Cycle ===
        cycleStartDate: {
            type: Date,
            required: [true, "Cycle start date is required"],
        },
        cycleEndDate: {
            type: Date,
            required: [true, "Cycle end date is required"],
        },
        cycleLabel: {
            type: String,
            required: [true, "Cycle label is required"],
        },

        // === Earnings Included ===
        earningIds: {
            type: [
                {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "ConsultantEarning",
                    required: true,
                },
            ],
            required: [true, "At least one earning is required"],
            validate: {
                validator: (earnings) => earnings.length > 0,
                message: "At least one earning is required",
            },
        },
        earningCount: {
            type: Number,
            required: [true, "Earning count is required"],
            min: [1, "Earning count must be at least 1"],
        },

        // === Financial Summary (kobo) ===
        grossAmount: {
            type: Number,
            required: [true, "Gross amount is required"],
            min: [0, "Gross amount cannot be negative"],
        },
        totalCommission: {
            type: Number,
            required: [true, "Total commission is required"],
            min: [0, "Total commission cannot be negative"],
        },
        netAmount: {
            type: Number,
            required: [true, "Net amount is required"],
            min: [MINIMUM_PAYOUT_KOBO, `Net amount must be at least ₦10,000 (${MINIMUM_PAYOUT_KOBO} kobo)`],
        },

        // === Status ===
        status: {
            type: String,
            enum: Object.values(PAYOUT_STATUS),
            default: PAYOUT_STATUS.PENDING,
        },

        // === Paystack Transfer ===
        paystackTransferReference: {
            type: String,
            default: null,
        },
        paystackTransferCode: {
            type: String,
            default: null,
        },
        transferRecipientCode: {
            type: String,
            required: [true, "Transfer recipient code is required"],
        },

        // === Failure Handling ===
        failureReason: {
            type: String,
            default: null,
        },
        retryCount: {
            type: Number,
            default: 0,
            max: [3, "Maximum retry attempts is 3"],
        },
        lastRetryAt: {
            type: Date,
            default: null,
        },

        // === Timestamps ===
        initiatedAt: {
            type: Date,
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },

        // === Audit Trail ===
        statusHistory: {
            type: [statusHistoryEventSchema],
            default: [],
        },
    },
    {
        timestamps: true,
        versionKey: false,
        toJSON: {
            virtuals: true,
            transform(doc, ret) {
                delete ret.__v;
                return ret;
            },
        },
        toObject: {
            virtuals: true,
        },
    }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Primary lookup
payoutSchema.index({ consultantId: 1, status: 1 });
payoutSchema.index({ consultantId: 1, cycleEndDate: 1 });

// Processing
payoutSchema.index({ status: 1, createdAt: 1 });

// Paystack reconciliation
payoutSchema.index({ paystackTransferReference: 1 });

// Unique constraint: one payout per consultant per cycle
payoutSchema.index(
    { consultantId: 1, cycleLabel: 1 },
    { unique: true }
);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate that cycleEndDate is after cycleStartDate.
 */
payoutSchema.pre("validate", function () {
    if (this.cycleStartDate && this.cycleEndDate) {
        if (this.cycleEndDate <= this.cycleStartDate) {
            this.invalidate(
                "cycleEndDate",
                "Cycle end date must be after cycle start date"
            );
        }
    }
});

/**
 * Validate that earningCount matches earningIds length.
 */
payoutSchema.pre("validate", function () {
    if (this.earningIds && this.earningCount !== undefined) {
        if (this.earningIds.length !== this.earningCount) {
            this.invalidate(
                "earningCount",
                `Earning count (${this.earningCount}) must match earningIds length (${this.earningIds.length})`
            );
        }
    }
});

/**
 * Validate financial summary balances.
 * grossAmount should equal totalCommission + netAmount (approximately, due to rounding).
 */
payoutSchema.pre("validate", function () {
    if (this.grossAmount !== undefined && this.totalCommission !== undefined && this.netAmount !== undefined) {
        const expectedGross = this.totalCommission + this.netAmount;
        // Allow for rounding differences of up to 1 kobo
        if (Math.abs(this.grossAmount - expectedGross) > 1) {
            this.invalidate(
                "grossAmount",
                `Gross amount (${this.grossAmount}) must equal totalCommission (${this.totalCommission}) + netAmount (${this.netAmount}) = ${expectedGross}`
            );
        }
    }
});

// ---------------------------------------------------------------------------
// Pre-save hooks
// ---------------------------------------------------------------------------

/**
 * Check immutable fields and record status history before save.
 */
payoutSchema.pre("save", function () {
    if (!this.isNew) {
        // Record status transition in history
        if (this.isModified("status")) {
            // Get original status from locals (set by post-save hook)
            const originalStatus = this.$locals.originalStatus;
            this.statusHistory.push({
                from: originalStatus || this.status,
                to: this.status,
                changedAt: new Date(),
            });
        }
    }
});

/**
 * Store original status after save for future modifications.
 */
payoutSchema.post("save", function (doc) {
    doc.$locals.originalStatus = doc.status;
});

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

/**
 * Check if the payout is in a terminal state.
 */
payoutSchema.virtual("isTerminal").get(function () {
    return (
        this.status === PAYOUT_STATUS.COMPLETED ||
        this.status === PAYOUT_STATUS.CANCELLED
    );
});

/**
 * Check if the payout can be retried.
 */
payoutSchema.virtual("canRetry").get(function () {
    return (
        this.status === PAYOUT_STATUS.FAILED &&
        this.retryCount < 3
    );
});

/**
 * Check if the payout is pending processing.
 */
payoutSchema.virtual("isPending").get(function () {
    return this.status === PAYOUT_STATUS.PENDING;
});

// ---------------------------------------------------------------------------
// Instance Methods
// ---------------------------------------------------------------------------

/**
 * Check if the payout includes a specific earning.
 * @param {string} earningId - The earning ID to check
 * @returns {boolean} True if earning is included
 */
payoutSchema.methods.hasEarning = function (earningId) {
    return this.earningIds.some(
        (id) => id.toString() === earningId.toString()
    );
};

/**
 * Get the earning count.
 * @returns {number} Number of earnings in this payout
 */
payoutSchema.methods.getEarningCount = function () {
    return this.earningIds.length;
};

// ---------------------------------------------------------------------------
// Model Export
// ---------------------------------------------------------------------------

const Payout = mongoose.model("Payout", payoutSchema);

export default Payout;
