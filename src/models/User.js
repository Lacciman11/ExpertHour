import mongoose from "mongoose";
import bcrypt from "bcrypt";
import validator from "validator";

import authConfig from "../config/auth.js";
import { USER_ROLES } from "../utils/constants.js";

const userSchema = new mongoose.Schema(
    {
        firstName: {
            type: String,
            required: [true, "First name is required"],
            trim: true,
            minlength: 2,
            maxlength: 50,
        },

        lastName: {
            type: String,
            required: [true, "Last name is required"],
            trim: true,
            minlength: 2,
            maxlength: 50,
        },

        email: {
            type: String,
            required: [true, "Email is required"],
            unique: true, // This already creates an index
            lowercase: true,
            trim: true,
            validate: {
                validator: validator.isEmail,
                message: "Please provide a valid email address",
            },
        },

        password: {
            type: String,
            required: [true, "Password is required"],
            minlength: 8,
            select: false,
        },

        role: {
            type: String,
            enum: Object.values(USER_ROLES),
            default: USER_ROLES.BUSINESS_OWNER,
        },

        avatar: {
            url: {
                type: String,
                default: "",
            },

            publicId: {
                type: String,
                default: "",
            },
        },

        isVerified: {
            type: Boolean,
            default: false,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        lastLogin: {
            type: Date,
            default: null,
        },

        timezone: {
            type: String,
            default: "UTC",
        },

        // Business owner specific fields
        business: {
            companyName: {
                type: String,
                trim: true,
                maxlength: [100, "Company name cannot exceed 100 characters"],
            },

            industry: {
                type: String,
                trim: true,
                maxlength: [100, "Industry cannot exceed 100 characters"],
            },

            companySize: {
                type: String,
                enum: {
                    values: ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"],
                    message: "Invalid company size",
                },
            },

            businessAddress: {
                type: String,
                trim: true,
                maxlength: [200, "Business address cannot exceed 200 characters"],
            },

            phone: {
                type: String,
                trim: true,
                maxlength: [20, "Phone number cannot exceed 20 characters"],
            },

            website: {
                type: String,
                trim: true,
                maxlength: [200, "Website URL cannot exceed 200 characters"],
            },

            description: {
                type: String,
                trim: true,
                maxlength: [500, "Description cannot exceed 500 characters"],
            },
        },
    },
    {
        timestamps: true,
        versionKey: false,
        toJSON: {
            virtuals: true,
            transform(doc, ret) {
                delete ret.password;
                return ret;
            },
        },
        toObject: {
            virtuals: true,
        },
    }
);

/*
|--------------------------------------------------------------------------
| Virtuals
|--------------------------------------------------------------------------
*/

userSchema.virtual("fullName").get(function () {
    return `${this.firstName} ${this.lastName}`;
});

/*
|--------------------------------------------------------------------------
| Password Hashing
|--------------------------------------------------------------------------
*/

userSchema.pre("save", async function () {
    if (!this.isModified("password")) return;

    this.password = await bcrypt.hash(
        this.password,
        authConfig.bcryptSaltRounds
    );
});

/*
|--------------------------------------------------------------------------
| Instance Methods
|--------------------------------------------------------------------------
*/

userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model("User", userSchema);

export default User; 