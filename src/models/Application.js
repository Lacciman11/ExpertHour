import mongoose from "mongoose";
import validator from "validator";

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
            trim: true,
            maxlength: [200, "LinkedIn profile URL cannot exceed 200 characters"],
            default: "",
        },

        currentTitle: {
            type: String,
            required: [true, "Current title is required"],
            trim: true,
            maxlength: [100, "Current title cannot exceed 100 characters"],
        },

        organisation: {
            type: String,
            required: [true, "Organisation name is required"],
            trim: true,
            maxlength: [100, "Organisation name cannot exceed 100 characters"],
        },

        yearsExperience: {
            type: String,
            required: [true, "Years of experience is required"],
            trim: true,
        },

        primaryIndustry: {
            type: String,
            required: [true, "Primary industry is required"],
            trim: true,
        },

        primaryIndustryOther: {
            type: String,
            trim: true,
            maxlength: [100, "Primary industry other cannot exceed 100 characters"],
            default: "",
        },

        primaryExpertise: {
            type: String,
            required: [true, "Primary expertise is required"],
            trim: true,
        },

        primaryExpertiseOther: {
            type: String,
            trim: true,
            maxlength: [100, "Primary expertise other cannot exceed 100 characters"],
            default: "",
        },

        otherExpertise: {
            type: String,
            trim: true,
            default: "",
        },

        otherExpertiseOther: {
            type: String,
            trim: true,
            maxlength: [100, "Other expertise other cannot exceed 100 characters"],
            default: "",
        },

        notableAchievement: {
            type: String,
            trim: true,
            maxlength: [500, "Notable achievement cannot exceed 500 characters"],
            default: "",
        },

        businessChallenge: {
            type: String,
            trim: true,
            maxlength: [500, "Business challenge cannot exceed 500 characters"],
            default: "",
        },

        certifications: {
            type: String,
            trim: true,
            maxlength: [500, "Certifications cannot exceed 500 characters"],
            default: "",
        },

        whyJoin: {
            type: String,
            required: [true, "Please tell us why you would like to join"],
            trim: true,
            maxlength: [500, "Why join cannot exceed 500 characters"],
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
