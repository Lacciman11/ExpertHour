import mongoose from "mongoose";

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
| Indexes
|--------------------------------------------------------------------------
*/

sessionSchema.index({
    user: 1,
    isRevoked: 1,
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