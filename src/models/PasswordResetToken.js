import mongoose from "mongoose";

const passwordResetTokenSchema = new mongoose.Schema(
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

        usedAt: {
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
passwordResetTokenSchema.index(
    { expiresAt: 1 },
    {
        expireAfterSeconds: 0,
    }
);


const PasswordResetToken = mongoose.model(
    "PasswordResetToken",
    passwordResetTokenSchema
);

export default PasswordResetToken;