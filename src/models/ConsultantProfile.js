import mongoose from "mongoose";

const consultantProfileSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "User ID is required"],
            unique: true,
        },

        bio: {
            type: String,
            required: [true, "Bio is required"],
            maxlength: [2000, "Bio cannot exceed 2000 characters"],
        },

        categories: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }],
            required: [true, "At least one category is required"],
            validate: {
                validator: (categories) => categories.length > 0,
                message: "At least one category is required",
            },
        },

        hourlyRate: {
            type: Number,
            required: [true, "Hourly rate is required"],
            min: [0, "Hourly rate cannot be negative"],
        },

        currency: {
            type: String,
            required: [true, "Currency is required"],
            default: "USD",
            uppercase: true,
            minlength: 3,
            maxlength: 3,
        },

        availability: {
            type: String,
            enum: {
                values: ["AVAILABLE", "BUSY", "UNAVAILABLE"],
                message: "Availability must be AVAILABLE, BUSY, or UNAVAILABLE",
            },
            default: "AVAILABLE",
        },

        experience: {
            type: Number,
            required: [true, "Years of experience is required"],
            min: [0, "Experience cannot be negative"],
            max: [50, "Experience cannot exceed 50 years"],
        },

        education: {
            type: String,
            maxlength: [500, "Education cannot exceed 500 characters"],
        },

        certifications: {
            type: [String],
            default: [],
        },

        languages: {
            type: [String],
            default: [],
        },

        location: {
            type: String,
            maxlength: [200, "Location cannot exceed 200 characters"],
        },

        website: {
            type: String,
            maxlength: [500, "Website URL cannot exceed 500 characters"],
        },

        linkedin: {
            type: String,
            maxlength: [500, "LinkedIn URL cannot exceed 500 characters"],
        },

        rating: {
            type: Number,
            default: 0,
            min: 0,
            max: 5,
        },

        reviewCount: {
            type: Number,
            default: 0,
            min: 0,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        googleCalendar: {
            accessToken: {
                type: String,
                default: null,
            },
            refreshToken: {
                type: String,
                default: null,
            },
            expiresAt: {
                type: Date,
                default: null,
            },
            connected: {
                type: Boolean,
                default: false,
            },
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

const ConsultantProfile = mongoose.model(
    "ConsultantProfile",
    consultantProfileSchema
);

export default ConsultantProfile;
