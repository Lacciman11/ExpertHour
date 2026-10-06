import mongoose from "mongoose";
import validator from "validator";

import { EXPERIENCE_OPTIONS, EXPERTISE_OPTIONS, INDUSTRY_OPTIONS } from "../utils/constants.js";

const applicationSchema = new mongoose.Schema(
    {
        fullName: {
            type: String,
            required: [true, "Full name is required"],
            trim: true,
            minlength: [2, "Full name must be at least 2 characters"],
            maxlength: [100, "Full name cannot exceed 100 characters"],
        },

        email: {
            type: String,
            required: [true, "Email is required"],
            unique: true,
            lowercase: true,
            trim: true,
            validate: {
                validator: validator.isEmail,
                message: "Please provide a valid email address",
            },
        },

        phone: {
            type: String,
            required: [true, "Phone number is required"],
            trim: true,
            maxlength: [20, "Phone number cannot exceed 20 characters"],
        },

        linkedinProfile: {
            type: String,
            required: [true, "LinkedIn profile is required"],
            trim: true,
            maxlength: [200, "LinkedIn profile URL cannot exceed 200 characters"],
        },

        currentTitle: {
            type: String,
            required: [true, "Current title is required"],
            trim: true,
            maxlength: [100, "Current title cannot exceed 100 characters"],
        },

        organisation: {
            type: String,
            required: false,
            trim: true,
            maxlength: [100, "Organisation name cannot exceed 100 characters"],
            default: "",
        },

        yearsExperience: {
            type: String,
            required: [true, "Years of experience is required"],
            trim: true,
            enum: EXPERIENCE_OPTIONS,
        },

        primaryIndustry: {
            type: [String],
            required: [true, "Primary industry is required"],
            trim: true,
            enum: INDUSTRY_OPTIONS,
        },

        primaryExpertise: {
            type: String,
            required: [true, "Primary expertise is required"],
            trim: true,
            maxlength: [100, "Primary expertise cannot exceed 100 characters"],
            enum: EXPERTISE_OPTIONS,
        },

        otherExpertise: {
            type: [String],
            required: false,
            trim: true,
            default: [],
            enum: EXPERTISE_OPTIONS,
        },

        notableAchievement: {
            type: String,
            required: [true, "Please share a notable professional achievement"],
            trim: true,
            maxlength: [1000, "Notable achievement cannot exceed 1000 characters"],
            default: "",
        },

        businessChallenge: {
            type: String,
            required: [true, "Please share a significant business challenge you have helped solve"],
            trim: true,
            maxlength: [1000, "Business challenge cannot exceed 1000 characters"],
            default: "",
        },

        certifications: {
            type: String,
            trim: true,
            maxlength: [500, "Certifications cannot exceed 500 characters"],
            default: "",
        },

        industryContributions: {
            type: String,
            trim: true,
            maxlength: [1000, "Industry contributions cannot exceed 1000 characters"],
            default: "",
        },

        projectsConsultingEvidence: {
            type: String,
            trim: true,
            maxlength: [1000, "Projects / consulting evidence cannot exceed 1000 characters"],
            default: "",
        },

        whyJoin: {
            type: String,
            required: [true, "Please tell us why you would like to join"],
            trim: true,
            maxlength: [1000, "Why join cannot exceed 1000 characters"],
        },

        additionalInfo: {
            type: String,
            trim: true,
            maxlength: [500, "Additional info cannot exceed 500 characters"],
            default: "",
        },

        consent: {
            type: String,
            required: [true, "Consent is required"],
            enum: ["Yes", "No"],
            default: "No",
        },

        cv: {
            type: {
                url: {
                    type: String,
                    default: "",
                },
                publicId: {
                    type: String,
                    default: "",
                },
                originalName: {
                    type: String,
                    default: "",
                },
                mimeType: {
                    type: String,
                    default: "",
                },
            },
            default: undefined,
        },

        cvs: [
            {
                url: {
                    type: String,
                    default: "",
                },
                publicId: {
                    type: String,
                    default: "",
                },
                originalName: {
                    type: String,
                    default: "",
                },
                mimeType: {
                    type: String,
                    default: "",
                },
            },
        ],

        qualifications: [
            {
                url: {
                    type: String,
                    default: "",
                },
                publicId: {
                    type: String,
                    default: "",
                },
                originalName: {
                    type: String,
                    default: "",
                },
                mimeType: {
                    type: String,
                    default: "",
                },
            },
        ],

        status: {
            type: String,
            enum: ["pending", "reviewed", "accepted", "rejected"],
            default: "pending",
        },

        googleSheetSynced: {
            type: Boolean,
            default: false,
        },

        googleSheetSyncedAt: {
            type: Date,
            default: null,
        },

        googleSheetSyncError: {
            type: String,
            default: "",
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

applicationSchema.index({ email: 1 });
applicationSchema.index({ status: 1 });
applicationSchema.index({ createdAt: -1 });

const Application = mongoose.model("Application", applicationSchema);

export default Application;
