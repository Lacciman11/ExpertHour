import mongoose from "mongoose";

const paymentRecoveryAuditSchema = new mongoose.Schema(
    {
        paymentReference: {
            type: String,
            required: [true, "Payment reference is required"],
            index: true,
        },
        paymentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Payment",
            required: false,
            default: null,
        },
        initiatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Initiating admin ID is required"],
        },
        initiatedAt: {
            type: Date,
            default: Date.now,
            required: true,
        },
        outcome: {
            type: String,
            enum: ["success", "failed", "error", "skipped", "not_found", "terminal", "processing"],
            required: [true, "Outcome is required"],
        },
        reason: {
            type: String,
            default: null,
        },
        reconciliationAttemptsBefore: {
            type: Number,
            default: 0,
        },
        reconciliationAttemptsAfter: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
);

// Index for querying by payment reference (most recent first)
paymentRecoveryAuditSchema.index({ paymentReference: 1, initiatedAt: -1 });

// Index for querying by initiating admin
paymentRecoveryAuditSchema.index({ initiatedBy: 1, initiatedAt: -1 });

const PaymentRecoveryAudit = mongoose.model("PaymentRecoveryAudit", paymentRecoveryAuditSchema);

export default PaymentRecoveryAudit;