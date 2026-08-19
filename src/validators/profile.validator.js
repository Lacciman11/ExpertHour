import { body } from "express-validator";

export const updateProfileValidator = [

    body("firstName")
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage("First name must be between 2 and 50 characters"),

    body("lastName")
        .optional()
        .trim()
        .isLength({ min: 2, max: 50 })
        .withMessage("Last name must be between 2 and 50 characters"),

    body("business.companyName")
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage("Company name cannot exceed 100 characters"),

    body("business.industry")
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage("Industry cannot exceed 100 characters"),

    body("business.companySize")
        .optional()
        .isIn(["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"])
        .withMessage("Invalid company size"),

    body("business.businessAddress")
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage("Business address cannot exceed 200 characters"),

    body("business.phone")
        .optional()
        .trim()
        .isLength({ max: 20 })
        .withMessage("Phone number cannot exceed 20 characters"),

    body("business.website")
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage("Website URL cannot exceed 200 characters"),

    body("business.description")
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage("Description cannot exceed 500 characters"),

];

export const changePasswordValidator = [

    body("currentPassword")
        .notEmpty()
        .withMessage("Current password is required"),

    body("newPassword")
        .isLength({ min: 8 })
        .withMessage("New password must be at least 8 characters"),

];
