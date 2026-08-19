import { param, query, body } from "express-validator";

export const adminPaginationQueryValidator = [

    query("page")
        .optional()
        .isInt({ min: 1 })
        .withMessage("Page must be a positive integer"),

    query("limit")
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage("Limit must be between 1 and 50"),

];

export const adminSearchQueryValidator = [

    query("search")
        .optional()
        .isString()
        .withMessage("Search must be a string")
        .isLength({ max: 100 })
        .withMessage("Search term cannot exceed 100 characters"),

];

export const adminStatusQueryValidator = [

    query("status")
        .optional()
        .isString()
        .withMessage("Status must be a string"),

];

export const adminUserIdParamValidator = [

    param("userId")
        .notEmpty()
        .withMessage("User ID is required")
        .isMongoId()
        .withMessage("Invalid user ID"),

];

export const adminProfileIdParamValidator = [

    param("profileId")
        .notEmpty()
        .withMessage("Profile ID is required")
        .isMongoId()
        .withMessage("Invalid profile ID"),

];

export const changeRoleBodyValidator = [

    body("role")
        .notEmpty()
        .withMessage("Role is required")
        .isIn(["BUSINESS_OWNER", "CONSULTANT", "ADMIN"])
        .withMessage("Role must be one of: BUSINESS_OWNER, CONSULTANT, ADMIN"),

];
