import { body } from "express-validator";

export const registerValidator = [
    body("firstName")
        .trim()
        .notEmpty()
        .withMessage("First name is required"),

    body("lastName")
        .trim()
        .notEmpty()
        .withMessage("Last name is required"),

    body("email")
        .isEmail()
        .withMessage("Invalid email address")
        .normalizeEmail(),

    body("password")
        .isLength({ min: 8 })
        .withMessage("Password must be at least 8 characters"),

    body("role")
        .optional()
        .isIn(["BUSINESS_OWNER", "CONSULTANT", "ADMIN"])
        .withMessage("Invalid role"),

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


export const loginValidator = [

    body("email")
        .trim()
        .isEmail()
        .withMessage("Please provide a valid email"),

    body("password")
        .notEmpty()
        .withMessage("Password is required"),

];

export const forgotPasswordValidator = [

    body("email")

        .trim()

        .isEmail()

        .withMessage("Please provide a valid email"),

];


export const resetPasswordValidator = [

    body("token")

        .trim()

        .notEmpty()

        .withMessage("Reset token is required"),

    body("password")

        .isLength({ min: 8 })

        .withMessage("Password must be at least 8 characters"),

];


export const resendVerificationEmailValidator = [

    body("email")

        .trim()

        .isEmail()

        .withMessage("Please provide a valid email"),

];
