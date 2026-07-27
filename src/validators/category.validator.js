import { body, param, query } from "express-validator";

export const createCategoryValidator = [
    body("name")
        .notEmpty()
        .withMessage("Category name is required")
        .isLength({ min: 2, max: 50 })
        .withMessage("Category name must be between 2 and 50 characters"),

    body("description")
        .optional()
        .isLength({ max: 500 })
        .withMessage("Description cannot exceed 500 characters"),

    body("icon")
        .optional()
        .isLength({ max: 100 })
        .withMessage("Icon cannot exceed 100 characters"),

    body("isActive")
        .optional()
        .isBoolean()
        .withMessage("isActive must be a boolean"),
];

export const updateCategoryValidator = [
    body("name")
        .optional()
        .isLength({ min: 2, max: 50 })
        .withMessage("Category name must be between 2 and 50 characters"),

    body("description")
        .optional()
        .isLength({ max: 500 })
        .withMessage("Description cannot exceed 500 characters"),

    body("icon")
        .optional()
        .isLength({ max: 100 })
        .withMessage("Icon cannot exceed 100 characters"),

    body("isActive")
        .optional()
        .isBoolean()
        .withMessage("isActive must be a boolean"),
];

export const categoryIdParamValidator = [
    param("id")
        .notEmpty()
        .withMessage("Category ID is required")
        .isMongoId()
        .withMessage("Invalid category ID"),
];

export const categoryQueryValidator = [
    query("page")
        .optional()
        .isInt({ min: 1 })
        .withMessage("Page must be a positive integer"),

    query("limit")
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage("Limit must be between 1 and 50"),

    query("search")
        .optional()
        .isLength({ max: 50 })
        .withMessage("Search term cannot exceed 50 characters"),

    query("isActive")
        .optional()
        .isBoolean()
        .withMessage("isActive must be a boolean"),
];
