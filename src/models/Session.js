import mongoose from "mongoose";
import crypto from "crypto";

const sessionSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        refreshTokenHash: {
            type: String,
            required: true,
        },

        // Token family for tracking refresh token rotation chain
        // All tokens in a rotation chain share the same family ID
        tokenFamily: {
            type: String,
            required: true,
            index: true,
        },

        // Hash of the previous refresh token in the rotation chain
        // Used to detect token reuse (if a token matches this, it was already rotated)
        previousTokenHash: {
            type: String,
            default: null,
        },

        deviceName: {
            type: String,
            default: "Unknown Device",
        },

        ipAddress: {
            type: String,
            default: "",
        },

        userAgent: {
            type: String,
            default: "",
        },

        expiresAt: {
            type: Date,
            required: true,
        },

        isRevoked: {
            type: Boolean,
            default: false,
        },

        lastUsedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

/*
|--------------------------------------------------------------------------
| Static Methods
|--------------------------------------------------------------------------
*/

sessionSchema.statics.generateTokenFamily = function () {
    return crypto.randomUUID();
};

/*
|--------------------------------------------------------------------------
| Indexes
|--------------------------------------------------------------------------
*/

sessionSchema.index({
    user: 1,
    isRevoked: 1,
});

sessionSchema.index({
    tokenFamily: 1,
});

// Index for token reuse detection - quickly find sessions by previous token hash
sessionSchema.index({
    previousTokenHash: 1,
});

sessionSchema.index(
    {
        expiresAt: 1,
    },
    {
        expireAfterSeconds: 0,
    }
);

const Session = mongoose.model(
    "Session",
    sessionSchema
);

export default Session;
