import mongoose from "mongoose";

const consultantAvailabilitySchema = new mongoose.Schema(
    {
        consultantProfileId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ConsultantProfile",
            required: [true, "Consultant profile ID is required"],
            index: true,
        },

        dayOfWeek: {
            type: Number,
            required: [true, "Day of week is required"],
            min: [0, "Day of week must be between 0 (Sunday) and 6 (Saturday)"],
            max: [6, "Day of week must be between 0 (Sunday) and 6 (Saturday)"],
        },

        startTime: {
            type: String,
            required: [true, "Start time is required"],
            match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"],
        },

        endTime: {
            type: String,
            required: [true, "End time is required"],
            match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)"],
        },

        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

/*
|--------------------------------------------------------------------------
| Compound Index: unique slot per consultant per day
|--------------------------------------------------------------------------
*/

consultantAvailabilitySchema.index(
    { consultantProfileId: 1, dayOfWeek: 1, startTime: 1 },
    { unique: true }
);

const ConsultantAvailability = mongoose.model(
    "ConsultantAvailability",
    consultantAvailabilitySchema
);

export default ConsultantAvailability;
