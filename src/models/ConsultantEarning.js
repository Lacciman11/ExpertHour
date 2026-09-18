import mongoose from "mongoose";

import {
    EARNING_STATUS,
    SESSION_OUTCOME,
    HOLD_REASON,
    DISPUTE_RESOLUTION,
    ADJUSTMENT_REASON,
    PLATFORM_COMMISSION_RATE,
} from "../utils/constants.js";

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

const refundEventSchema = new mongoose.Schema(
    {
        refundReference: {
            type: String,
            required: [true, "Refund reference is required"],
        },
        refundAmount: {
            type: Number,
            required: [true, "Refund amount is required"],
            min: [1, "Refund amount must be at least 1 kobo"],
        },
        cumulativeRefundAmount: {
            type: Number,
            required: [true, "Cumulative refund amount is required"],
            min: [0, "Cumulative refund amount cannot be negative"],
        },
        previousAdjustedGrossAmount: {
            type: Number,
            required: [true, "Previous adjusted gross amount is required"],
            min: [0, "Previous adjusted gross amount cannot be negative"],
        },
        newAdjustedGrossAmount: {
            type: Number,
            required: [true, "New adjusted gross amount is required"],
            min: [0, "New adjusted gross amount cannot be negative"],
        },
        previousAdjustedPlatformCommission: {
            type: Number,
            required: [true, "Previous adjusted platform commission is required"],
            min: [0, "Previous adjusted platform commission cannot be negative"],
        },
        newAdjustedPlatformCommission: {
            type: Number,
            required: [true, "New adjusted platform commission is required"],
            min: [0, "New adjusted platform commission cannot be negative"],
        },
        previousAdjustedConsultantEntitlement: {
            type: Number,
            required: [true, "Previous adjusted consultant entitlement is required"],
            min: [0, "Previous adjusted consultant entitlement cannot be negative"],
        },
        newAdjustedConsultantEntitlement: {
            type: Number,
            required: [true, "New adjusted consultant entitlement is required"],
            min: [0, "New adjusted consultant entitlement cannot be negative"],
        },
        reason: {
            type: String,
            enum: Object.values(ADJUSTMENT_REASON),
            required: [true, "Refund reason is required"],
        },
        processedAt: {
            type: Date,
            default: Date.now,
        },
        processedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
    },
    { _id: false }
);

const statusHistoryEventSchema = new mongoose.Schema(
    {
        from: String,
        to: {
            type: String,
            enum: Object.values(EARNING_STATUS),
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
// Post-Payout Recovery Sub-schema
// ---------------------------------------------------------------------------

/**
 * Recovery event: created when a refund is processed after the consultant has
 * already been paid. Records the consultant's obligation to return funds.
 * Append-only; keyed by refundReference for idempotency.
 */
const recoveryEventSchema = new mongoose.Schema(
    {
        refundReference: {
            type: String,
            required: [true, "Refund reference is required"],
        },
        recoveryAmount: {
            type: Number,
            required: [true, "Recovery amount is required"],
            min: [0, "Recovery amount cannot be negative"],
        },
        reason: {
            type: String,
            enum: Object.values(ADJUSTMENT_REASON),
            required: [true, "Recovery reason is required"],
        },
        processedAt: {
            type: Date,
            default: Date.now,
        },
        processedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
    },
    { _id: false }
);

// ---------------------------------------------------------------------------
// Main Schema
// ---------------------------------------------------------------------------

const consultantEarningSchema = new mongoose.Schema(
    {
        // === Core References ===
        bookingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Booking",
            required: [true, "Booking ID is required"],
            unique: true, // One earning per booking (idempotency)
        },
        paymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            required: [true, "Payment ID is required"],
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
        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Client ID is required"],
        },
        sessionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ConsultationSession",
            default: null,
        },

        // === Immutable Financial Snapshot (kobo) ===
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
        consultantEntitlement: {
            type: Number,
            required: [true, "Consultant entitlement is required"],
            min: [0, "Consultant entitlement cannot be negative"],
        },
        platformCommissionRate: {
            type: Number,
            required: [true, "Platform commission rate is required"],
            default: PLATFORM_COMMISSION_RATE.DEFAULT,
            min: [0, "Platform commission rate cannot be negative"],
            max: [1, "Platform commission rate cannot exceed 1"],
        },

        // === Session Outcome ===
        sessionOutcome: {
            type: String,
            enum: Object.values(SESSION_OUTCOME),
            required: [true, "Session outcome is required"],
        },

        // === Status Lifecycle ===
        status: {
            type: String,
            enum: Object.values(EARNING_STATUS),
            default: EARNING_STATUS.PENDING,
        },

        // === Eligibility Tracking ===
        eligibleAt: {
            type: Date,
            default: null,
        },
        holdReason: {
            type: String,
            enum: [
                null,
                ...Object.values(HOLD_REASON),
            ],
            default: null,
        },

        // === Dispute Reference ===
        disputeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Dispute", // Will be created in Phase 3
            default: null,
        },
        disputeOpenedAt: {
            type: Date,
            default: null,
        },
        disputeResolvedAt: {
            type: Date,
            default: null,
        },
        disputeResolution: {
            type: String,
            enum: [
                null,
                ...Object.values(DISPUTE_RESOLUTION),
            ],
            default: null,
        },

        // === Payout Reference ===
        payoutId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payout",
            default: null,
        },
        paidAt: {
            type: Date,
            default: null,
        },

        // === Financial Adjustments (original snapshot preserved) ===
        adjustmentAmount: {
            type: Number,
            default: 0,
            min: [0, "Adjustment amount cannot be negative"],
        },
        adjustedGrossAmount: {
            type: Number,
            default: null,
            min: [0, "Adjusted gross amount cannot be negative"],
        },
        adjustedConsultantEntitlement: {
            type: Number,
            default: null,
            min: [0, "Adjusted consultant entitlement cannot be negative"],
        },
        adjustedPlatformCommission: {
            type: Number,
            default: null,
            min: [0, "Adjusted platform commission cannot be negative"],
        },
        adjustmentReason: {
            type: String,
            enum: [
                null,
                ...Object.values(ADJUSTMENT_REASON),
            ],
            default: null,
        },
        adjustedAt: {
            type: Date,
            default: null,
        },
        adjustedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        // === Refund Event History (append-only) ===
        refundHistory: {
            type: [refundEventSchema],
            default: [],
        },

        // === Post-Payout Recovery (kobo) ===
        // When a refund is processed AFTER the consultant has already been paid,
        // the earning's adjustment accounting cannot absorb it (it is bounded by
        // grossAmount). Instead, a recovery obligation is recorded against the
        // consultant. The immutable financial snapshot fields above are never
        // modified by recovery.
        recoveryAmount: {
            type: Number,
            default: 0,
            min: [0, "Recovery amount cannot be negative"],
        },
        recoveredAmount: {
            type: Number,
            default: 0,
            min: [0, "Recovered amount cannot be negative"],
        },
        recoveryHistory: {
            type: [recoveryEventSchema],
            default: [],
        },

        // === Audit Trail ===
        statusHistory: {
            type: [statusHistoryEventSchema],
            default: [],
        },

        // === Optimistic Concurrency Control ===
        version: {
            type: Number,
            default: 0,
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

consultantEarningSchema.index({ bookingId: 1 }, { unique: true });
consultantEarningSchema.index({ consultantId: 1, status: 1 });
consultantEarningSchema.index({ status: 1, eligibleAt: 1 });
consultantEarningSchema.index({ payoutId: 1 });
consultantEarningSchema.index({ disputeId: 1 });
consultantEarningSchema.index({ createdAt: -1 });
consultantEarningSchema.index({ eligibleAt: 1 });
// RefundService queries by paymentId during refund processing.
consultantEarningSchema.index({ paymentId: 1 });

// ---------------------------------------------------------------------------
// Validation: Accounting Invariants
// ---------------------------------------------------------------------------

/**
 * Validate that the original financial snapshot balances.
 */
consultantEarningSchema.pre("validate", function () {
    if (this.isNew) {
        const expectedSum = this.platformCommission + this.consultantEntitlement;
        if (this.grossAmount !== expectedSum) {
            this.invalidate(
                "grossAmount",
                `Gross amount (${this.grossAmount}) must equal platformCommission (${this.platformCommission}) + consultantEntitlement (${this.consultantEntitlement}) = ${expectedSum}`
            );
        }
    }
});

/**
 * Validate adjustment fields consistency.
 */
consultantEarningSchema.pre("validate", function () {
    const hasAdjustedGross = this.adjustedGrossAmount !== null;
    const hasAdjustedCommission = this.adjustedPlatformCommission !== null;
    const hasAdjustedEntitlement = this.adjustedConsultantEntitlement !== null;

    const hasAnyAdjusted = hasAdjustedGross || hasAdjustedCommission || hasAdjustedEntitlement;
    const hasAllAdjusted = hasAdjustedGross && hasAdjustedCommission && hasAdjustedEntitlement;

    if (hasAnyAdjusted && !hasAllAdjusted) {
        this.invalidate(
            "adjustedGrossAmount",
            "Adjusted fields must all be null or all have values. Cannot have partial adjustment."
        );
    }

    if (hasAllAdjusted) {
        const adjustedSum = this.adjustedPlatformCommission + this.adjustedConsultantEntitlement;
        if (this.adjustedGrossAmount !== adjustedSum) {
            this.invalidate(
                "adjustedGrossAmount",
                `Adjusted gross amount (${this.adjustedGrossAmount}) must equal adjustedPlatformCommission (${this.adjustedPlatformCommission}) + adjustedConsultantEntitlement (${this.adjustedConsultantEntitlement}) = ${adjustedSum}`
            );
        }

        // For zero-grossAmount earnings (e.g., CONSULTANT_NO_SHOW), the refund
        // amount is based on the original Payment, not the earning's grossAmount.
        // Allow adjustmentAmount to exceed grossAmount in that case.
        if (this.grossAmount > 0) {
            const expectedAdjustment = this.grossAmount - this.adjustedGrossAmount;
            if (this.adjustmentAmount !== expectedAdjustment) {
                this.invalidate(
                    "adjustmentAmount",
                    `Adjustment amount (${this.adjustmentAmount}) must equal grossAmount (${this.grossAmount}) - adjustedGrossAmount (${this.adjustedGrossAmount}) = ${expectedAdjustment}`
                );
            }
        }

        if (this.adjustedGrossAmount > this.grossAmount) {
            this.invalidate(
                "adjustedGrossAmount",
                "Adjusted gross amount cannot exceed original gross amount"
            );
        }
        if (this.adjustedConsultantEntitlement > this.consultantEntitlement) {
            this.invalidate(
                "adjustedConsultantEntitlement",
                "Adjusted consultant entitlement cannot exceed original consultant entitlement"
            );
        }
        if (this.adjustedPlatformCommission > this.platformCommission) {
            this.invalidate(
                "adjustedPlatformCommission",
                "Adjusted platform commission cannot exceed original platform commission"
            );
        }
    }
});

/**
 * Validate refund history cumulative amounts.
 */
consultantEarningSchema.pre("validate", function () {
    if (this.refundHistory && this.refundHistory.length > 0) {
        let runningCumulative = 0;
        for (let i = 0; i < this.refundHistory.length; i++) {
            const event = this.refundHistory[i];
            runningCumulative += event.refundAmount;

            if (event.cumulativeRefundAmount !== runningCumulative) {
                this.invalidate(
                    "refundHistory",
                    `Refund event ${i} cumulativeRefundAmount (${event.cumulativeRefundAmount}) does not match expected cumulative (${runningCumulative})`
                );
            }
        }

        // For zero-grossAmount earnings (e.g., CONSULTANT_NO_SHOW), the refund
        // amount is based on the original Payment, not the earning's grossAmount.
        // Allow cumulative refunds to exceed grossAmount in that case.
        if (this.grossAmount > 0 && runningCumulative > this.grossAmount) {
            this.invalidate(
                "refundHistory",
                `Cumulative refunds (${runningCumulative}) cannot exceed grossAmount (${this.grossAmount})`
            );
        }

        if (this.grossAmount > 0 && this.adjustmentAmount !== runningCumulative) {
            this.invalidate(
                "adjustmentAmount",
                `adjustmentAmount (${this.adjustmentAmount}) must equal cumulative refunds (${runningCumulative})`
            );
        }
    }
});

/**
 * Validate unique refundReference within refundHistory.
 */
consultantEarningSchema.pre("validate", function () {
    if (this.refundHistory && this.refundHistory.length > 0) {
        const references = this.refundHistory.map((e) => e.refundReference);
        const uniqueRefs = new Set(references);
        if (uniqueRefs.size !== references.length) {
            this.invalidate(
                "refundHistory",
                "refundReference must be unique within refundHistory array"
            );
        }
    }
});

/**
 * Validate post-payout recovery invariants.
 * - recoveredAmount can never exceed recoveryAmount (cannot recover more than owed).
 * - recoveryAmount is capped at the consultant's immutable entitlement (a consultant
 *   cannot owe more than they were originally entitled to receive).
 * - refundReference must be unique within recoveryHistory.
 */
consultantEarningSchema.pre("validate", function () {
    if (this.recoveredAmount > this.recoveryAmount) {
        this.invalidate(
            "recoveredAmount",
            `recoveredAmount (${this.recoveredAmount}) cannot exceed recoveryAmount (${this.recoveryAmount})`
        );
    }

    if (this.recoveryAmount > this.consultantEntitlement) {
        this.invalidate(
            "recoveryAmount",
            `recoveryAmount (${this.recoveryAmount}) cannot exceed consultantEntitlement (${this.consultantEntitlement})`
        );
    }

    if (this.recoveryHistory && this.recoveryHistory.length > 0) {
        const references = this.recoveryHistory.map((e) => e.refundReference);
        const uniqueRefs = new Set(references);
        if (uniqueRefs.size !== references.length) {
            this.invalidate(
                "recoveryHistory",
                "refundReference must be unique within recoveryHistory array"
            );
        }
    }
});

// ---------------------------------------------------------------------------
// Pre-save hooks
// ---------------------------------------------------------------------------

/**
 * Check immutable fields, increment version, and record status history before save.
 */
consultantEarningSchema.pre("save", function () {
    if (!this.isNew) {
        // Check immutable fields
        const immutableFields = [
            "grossAmount",
            "platformCommission",
            "consultantEntitlement",
            "platformCommissionRate",
        ];

        for (const field of immutableFields) {
            if (this.isModified(field)) {
                throw new Error(`${field} is immutable and cannot be modified after creation`);
            }
        }

        // Increment version for optimistic concurrency
        this.version = (this.version || 0) + 1;

        // Record status transition in history
        if (this.isModified("status")) {
            // Get the original status before modification
            // Mongoose stores the original value in $locals or we can use getChanges
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
 * Store original status after save for status history tracking.
 * This ensures we have the original status before any modifications.
 */
consultantEarningSchema.post("save", function (doc) {
    // Store the current status as the original status for future modifications
    doc.$locals.originalStatus = doc.status;
});

// ---------------------------------------------------------------------------
// Virtuals
// ---------------------------------------------------------------------------

consultantEarningSchema.virtual("payableGrossAmount").get(function () {
    return this.adjustedGrossAmount !== null
        ? this.adjustedGrossAmount
        : this.grossAmount;
});

consultantEarningSchema.virtual("payableConsultantAmount").get(function () {
    return this.adjustedConsultantEntitlement !== null
        ? this.adjustedConsultantEntitlement
        : this.consultantEntitlement;
});

consultantEarningSchema.virtual("payablePlatformCommission").get(function () {
    return this.adjustedPlatformCommission !== null
        ? this.adjustedPlatformCommission
        : this.platformCommission;
});

consultantEarningSchema.virtual("remainingRefundableAmount").get(function () {
    return this.grossAmount - this.adjustmentAmount;
});

consultantEarningSchema.virtual("isFullyRefunded").get(function () {
    return this.adjustmentAmount >= this.grossAmount;
});

consultantEarningSchema.virtual("hasRefunds").get(function () {
    return this.refundHistory && this.refundHistory.length > 0;
});

consultantEarningSchema.virtual("outstandingRecovery").get(function () {
    return (this.recoveryAmount || 0) - (this.recoveredAmount || 0);
});

consultantEarningSchema.virtual("hasRecovery").get(function () {
    return this.recoveryAmount > 0;
});

// ---------------------------------------------------------------------------
// Instance Methods
// ---------------------------------------------------------------------------

consultantEarningSchema.methods.hasRefund = function (refundReference) {
    return this.refundHistory.some(
        (event) => event.refundReference === refundReference
    );
};

consultantEarningSchema.methods.getRefund = function (refundReference) {
    return this.refundHistory.find(
        (event) => event.refundReference === refundReference
    ) || null;
};

consultantEarningSchema.methods.hasRecoveryForReference = function (refundReference) {
    return this.recoveryHistory.some(
        (event) => event.refundReference === refundReference
    );
};

consultantEarningSchema.methods.getRecoveryByReference = function (refundReference) {
    return this.recoveryHistory.find(
        (event) => event.refundReference === refundReference
    ) || null;
};

// ---------------------------------------------------------------------------
// Static Methods
// ---------------------------------------------------------------------------

/**
 * Get the total outstanding recovery balance across all of a consultant's earnings.
 * @param {string|object} consultantId - The consultant's user ID
 * @param {object} [session] - Optional Mongoose session for transaction support
 * @returns {Promise<number>} Total outstanding recovery in kobo
 */
consultantEarningSchema.statics.getTotalOutstandingRecovery = async function (
    consultantId,
    session
) {
    const result = await this.aggregate([
        { $match: { consultantId: new mongoose.Types.ObjectId(consultantId) } },
        {
            $group: {
                _id: null,
                total: {
                    $sum: { $subtract: ["$recoveryAmount", "$recoveredAmount"] },
                },
            },
        },
    ]).session(session || null);

    return result.length > 0 ? result[0].total : 0;
};

/**
 * Apply a recovery offset against a consultant's oldest outstanding recovery
 * obligations. This is how future earnings/clawbacks settle a post-payout debt.
 *
 * Distributes `amount` across earnings with outstanding recovery (oldest first),
 * increasing each earning's recoveredAmount. Does not touch the immutable
 * financial snapshot or the adjustment accounting.
 *
 * @param {string|object} consultantId - The consultant's user ID
 * @param {number} amount - Amount to offset in kobo (must be positive)
 * @param {object} [session] - Optional Mongoose session for transaction support
 * @returns {Promise<object>} { recovered, remaining } - recovered is the amount
 *   actually applied; remaining is any amount that could not be absorbed
 *   (no outstanding recovery left).
 */
consultantEarningSchema.statics.applyRecoveryOffset = async function (
    consultantId,
    amount,
    session
) {
    const offset = Math.max(0, Math.floor(amount));

    if (offset <= 0) {
        return { recovered: 0, remaining: 0 };
    }

    // Oldest recovery obligations first (by when they were paid).
    const earnings = await this.find({
        consultantId: new mongoose.Types.ObjectId(consultantId),
        recoveryAmount: { $gt: 0 },
    })
        .sort({ paidAt: 1, createdAt: 1 })
        .session(session || null);

    let remaining = offset;
    let recovered = 0;

    for (const earning of earnings) {
        if (remaining <= 0) {
            break;
        }

        const outstanding = earning.recoveryAmount - (earning.recoveredAmount || 0);
        if (outstanding <= 0) {
            continue;
        }

        const apply = Math.min(outstanding, remaining);
        earning.recoveredAmount = (earning.recoveredAmount || 0) + apply;
        // Guard against floating-point drift pushing recovered above recovery.
        if (earning.recoveredAmount > earning.recoveryAmount) {
            earning.recoveredAmount = earning.recoveryAmount;
        }
        await earning.save({ session: session || null });

        remaining -= apply;
        recovered += apply;
    }

    return { recovered, remaining: offset - recovered };
};

// ---------------------------------------------------------------------------
// Model Export
// ---------------------------------------------------------------------------

const ConsultantEarning = mongoose.model(
    "ConsultantEarning",
    consultantEarningSchema
);

export default ConsultantEarning;
