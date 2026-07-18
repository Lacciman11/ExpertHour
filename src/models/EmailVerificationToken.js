import mongoose from "mongoose";

const emailVerificationTokenSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        tokenHash: {
            type: String,
            required: true,
            unique: true,
        },

        expiresAt: {
            type: Date,
            required: true,
        },

        verifiedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
*/

// Automatically delete expired documents
emailVerificationTokenSchema.index(
    { expiresAt: 1 },
    {
        expireAfterSeconds: 0,
    }
);

const EmailVerificationToken = mongoose.model(
    "EmailVerificationToken",
    emailVerificationTokenSchema
);

export default EmailVerificationToken;
