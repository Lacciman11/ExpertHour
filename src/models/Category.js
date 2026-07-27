import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, "Category name is required"],
            unique: true,
            trim: true,
            minlength: [2, "Category name must be at least 2 characters"],
            maxlength: [50, "Category name cannot exceed 50 characters"],
        },

        description: {
            type: String,
            maxlength: [500, "Description cannot exceed 500 characters"],
            default: "",
        },

        icon: {
            type: String,
            maxlength: [100, "Icon cannot exceed 100 characters"],
            default: "",
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

const Category = mongoose.model("Category", categorySchema);

export default Category;
