import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import categoryService from "../services/category.service.js";

export const createCategory = asyncHandler(async (req, res) => {

    const category = await categoryService.create(req.body);

    return res.status(201).json(
        new ApiResponse(
            201,
            category,
            "Category created successfully"
        )
    );

});

export const getAllCategories = asyncHandler(async (req, res) => {

    const { page, limit, search, isActive } = req.query;

    const result = await categoryService.findAll({
        page,
        limit,
        search,
        isActive: isActive !== undefined ? isActive === "true" : undefined,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Categories fetched successfully"
        )
    );

});

export const getCategoryById = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const category = await categoryService.findById(id);

    if (!category) {

        return res.status(404).json({

            success: false,

            message: "Category not found",

        });

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            category,
            "Category fetched successfully"
        )
    );

});

export const updateCategory = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const category = await categoryService.update(id, req.body);

    if (!category) {

        return res.status(404).json({

            success: false,

            message: "Category not found",

        });

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            category,
            "Category updated successfully"
        )
    );

});

export const deleteCategory = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const category = await categoryService.delete(id);

    if (!category) {

        return res.status(404).json({

            success: false,

            message: "Category not found",

        });

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            null,
            "Category deleted successfully"
        )
    );

});
