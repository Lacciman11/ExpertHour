import mongoose from "mongoose";
import crypto from "crypto";

const PAYSTACK_RECIPIENT_ATTEMPT_STATUS = Object.freeze({
    IN_PROGRESS: "IN_PROGRESS",
    SUCCEEDED: "SUCCEEDED",
    FAILED: "FAILED",
    UNKNOWN: "UNKNOWN",
});

function computeAttemptKey({ payoutMethod, bankCode, accountNumber, currency }) {
    const normalized = [
        payoutMethod || "",
        bankCode || "",
        accountNumber || "",
        currency || "NGN",
    ]
        .join("|")
        .toLowerCase();
    return crypto.createHash("sha256").update(normalized).digest("hex");
}

const paystackRecipientAttemptSchema = new mongoose.Schema(
    {
        consultantProfileId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ConsultantProfile",
            required: [true, "Consultant profile ID is required"],
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "User ID is required"],
        },
        attemptKey: {
            type: String,
            required: [true, "Attempt key is required"],
            index: true,
        },
        status: {
            type: String,
            enum: {
                values: Object.values(PAYSTACK_RECIPIENT_ATTEMPT_STATUS),
                message: "Invalid paystack recipient attempt status",
            },
            default: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.IN_PROGRESS,
        },
        recipientCode: {
            type: String,
            default: null,
        },
        errorCode: {
            type: String,
            default: null,
            maxlength: [200, "Error code cannot exceed 200 characters"],
        },
        errorSummary: {
            type: String,
            default: null,
            maxlength: [500, "Error summary cannot exceed 500 characters"],
        },
        startedAt: {
            type: Date,
            default: Date.now,
        },
        completedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

// Support atomic coordination and prevent multiple active attempts for same profile+attemptKey
// Only one active attempt (IN_PROGRESS or UNKNOWN) per (consultantProfileId, attemptKey)
paystackRecipientAttemptSchema.index(
    { consultantProfileId: 1, attemptKey: 1 },
    {
        unique: true,
        partialFilterExpression: {
            status: { $in: ["IN_PROGRESS", "UNKNOWN"] },
        },
    }
);
// Historical lookups
paystackRecipientAttemptSchema.index(
    { consultantProfileId: 1, attemptKey: 1, status: 1 }
);

const PaystackRecipientAttempt = mongoose.model(
    "PaystackRecipientAttempt",
    paystackRecipientAttemptSchema
);

export { PAYSTACK_RECIPIENT_ATTEMPT_STATUS, computeAttemptKey };
export default PaystackRecipientAttempt;
