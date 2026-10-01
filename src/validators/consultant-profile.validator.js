import { body, query } from "express-validator";

export const createConsultantProfileValidator = [

    body("bio")
        .notEmpty()
        .withMessage("Bio is required")
        .isLength({ max: 2000 })
        .withMessage("Bio cannot exceed 2000 characters"),

    body("categories")
        .isArray({ min: 1 })
        .withMessage("At least one category is required")
        .custom((categories) => {

            if (!categories || !Array.isArray(categories)) {

                return true;

            }

            if (!categories.every((cat) => typeof cat === "string" && cat.trim() !== "")) {

                throw new Error("Categories must be valid category IDs");

            }

            return true;

        }),

    body("hourlyRate")
        .isFloat({ min: 0, finite: true })
        .withMessage("Hourly rate must be a positive number"),

    body("currency")
        .optional()
        .isLength({ min: 3, max: 3 })
        .withMessage("Currency must be a 3-letter code"),

    body("availability")
        .optional()
        .isIn(["AVAILABLE", "BUSY", "UNAVAILABLE"])
        .withMessage("Availability must be AVAILABLE, BUSY, or UNAVAILABLE"),

    body("experience")
        .isInt({ min: 0, max: 50 })
        .withMessage("Experience must be between 0 and 50 years"),

    body("education")
        .optional()
        .isLength({ max: 500 })
        .withMessage("Education cannot exceed 500 characters"),

    body("certifications")
        .optional()
        .isArray()
        .withMessage("Certifications must be an array"),

    body("languages")
        .optional()
        .isArray()
        .withMessage("Languages must be an array"),

    body("location")
        .optional()
        .isLength({ max: 200 })
        .withMessage("Location cannot exceed 200 characters"),

    body("website")
        .optional()
        .isURL()
        .withMessage("Website must be a valid URL"),

    body("linkedin")
        .optional()
        .isURL()
        .withMessage("LinkedIn must be a valid URL"),

    body("avatar")
        .optional()
        .isObject()
        .withMessage("Avatar must be an object"),

    body("payoutMethod")
        .optional()
        .isIn(["paystack", "payoneer"])
        .withMessage("Payout method must be paystack or payoneer"),

    body("bankName")
        .optional()
        .isLength({ max: 100 })
        .withMessage("Bank name cannot exceed 100 characters"),

    body("accountNumber")
        .optional()
        .isLength({ max: 10 })
        .withMessage("Account number cannot exceed 10 characters"),

    body("accountName")
        .optional()
        .isLength({ max: 100 })
        .withMessage("Account name cannot exceed 100 characters"),

    body("payoneerId")
        .optional()
        .isLength({ max: 100 })
        .withMessage("Payoneer ID cannot exceed 100 characters"),

];

export const updateConsultantProfileValidator = [

    body("bio")
        .optional()
        .isLength({ max: 2000 })
        .withMessage("Bio cannot exceed 2000 characters"),

    body("skills")
        .optional()
        .isArray({ min: 1 })
        .withMessage("At least one skill is required")
        .custom((skills) => {

            if (!skills || !Array.isArray(skills)) {

                return true;

            }

            if (!skills.every((skill) => typeof skill === "string" && skill.trim() !== "")) {

                throw new Error("Skills must be non-empty strings");

            }

            return true;

        }),

    body("hourlyRate")
        .optional()
        .isFloat({ min: 0, finite: true })
        .withMessage("Hourly rate must be a positive number"),

    body("currency")
        .optional()
        .isLength({ min: 3, max: 3 })
        .withMessage("Currency must be a 3-letter code"),

    body("availability")
        .optional()
        .isIn(["AVAILABLE", "BUSY", "UNAVAILABLE"])
        .withMessage("Availability must be AVAILABLE, BUSY, or UNAVAILABLE"),

    body("experience")
        .optional()
        .isInt({ min: 0, max: 50 })
        .withMessage("Experience must be between 0 and 50 years"),

    body("education")
        .optional()
        .isLength({ max: 500 })
        .withMessage("Education cannot exceed 500 characters"),

    body("certifications")
        .optional()
        .isArray()
        .withMessage("Certifications must be an array"),

    body("languages")
        .optional()
        .isArray()
        .withMessage("Languages must be an array"),

    body("location")
        .optional()
        .isLength({ max: 200 })
        .withMessage("Location cannot exceed 200 characters"),

    body("website")
        .optional()
        .isURL()
        .withMessage("Website must be a valid URL"),

    body("linkedin")
        .optional()
        .isURL()
        .withMessage("LinkedIn must be a valid URL"),

];

export const bankListValidator = [];

export const verifyAccountValidator = [
    query("accountNumber")
        .notEmpty()
        .withMessage("accountNumber is required")
        .isLength({ min: 10, max: 10 })
        .withMessage("accountNumber must be exactly 10 digits")
        .matches(/^\d+$/)
        .withMessage("accountNumber must contain only digits"),
    query("bankCode")
        .notEmpty()
        .withMessage("bankCode is required")
        .matches(/^\d+$/)
        .withMessage("bankCode must contain only digits"),
];

export const payoutSettingsValidator = [
    body("payoutMethod")
        .optional()
        .isIn(["paystack", "payoneer"])
        .withMessage("Payout method must be paystack or payoneer"),
    body("bankName")
        .optional()
        .isLength({ max: 100 })
        .withMessage("Bank name cannot exceed 100 characters"),
    body("bankCode")
        .optional()
        .matches(/^\d+$/)
        .withMessage("Bank code must contain only digits"),
    body("accountNumber")
        .optional()
        .matches(/^\d+$/)
        .withMessage("Account number must contain only digits")
        .isLength({ min: 10, max: 10 })
        .withMessage("Account number must be exactly 10 digits"),
    body("accountName")
        .optional()
        .isLength({ max: 100 })
        .withMessage("Account name cannot exceed 100 characters")
        .custom((value) => {
            if (value && value.trim() === "") {
                throw new Error("Account name cannot be empty");
            }
            return true;
        }),
    body("payoneerId")
        .optional()
        .isLength({ max: 100 })
        .withMessage("Payoneer ID cannot exceed 100 characters"),
];

export const updatePayoutSettingsValidator = [
    body("payoutMethod")
        .optional()
        .isIn(["paystack", "payoneer"])
        .withMessage("Payout method must be paystack or payoneer"),
    body("bankName")
        .optional()
        .isLength({ max: 100 })
        .withMessage("Bank name cannot exceed 100 characters"),
    body("bankCode")
        .optional()
        .matches(/^\d+$/)
        .withMessage("Bank code must contain only digits"),
    body("accountNumber")
        .optional()
        .matches(/^\d+$/)
        .withMessage("Account number must contain only digits")
        .isLength({ min: 10, max: 10 })
        .withMessage("Account number must be exactly 10 digits"),
    body("accountName")
        .optional()
        .isLength({ max: 100 })
        .withMessage("Account name cannot exceed 100 characters")
        .custom((value) => {
            if (value && value.trim() === "") {
                throw new Error("Account name cannot be empty");
            }
            return true;
        }),
    body("payoneerId")
        .optional()
        .isLength({ max: 100 })
        .withMessage("Payoneer ID cannot exceed 100 characters"),
];

export const consultantSearchValidator = [

    query("categories")
        .optional()
        .isString()
        .withMessage("Categories must be a comma-separated string of category IDs"),

    query("minRate")
        .optional()
        .isFloat({ min: 0 })
        .withMessage("Min rate must be a positive number"),

    query("maxRate")
        .optional()
        .isFloat({ min: 0 })
        .withMessage("Max rate must be a positive number"),

    query("availability")
        .optional()
        .isIn(["AVAILABLE", "BUSY", "UNAVAILABLE"])
        .withMessage("Availability must be AVAILABLE, BUSY, or UNAVAILABLE"),

    query("location")
        .optional()
        .isString()
        .withMessage("Location must be a string"),

    query("search")
        .optional()
        .isString()
        .withMessage("Search must be a string"),

    query("category")
        .optional()
        .isString()
        .withMessage("Category must be a string"),

    query("sort")
        .optional()
        .isIn(["newest", "price-asc", "price-desc", "name-asc"])
        .withMessage("Sort must be one of: newest, price-asc, price-desc, name-asc"),

    query("page")
        .optional()
        .isInt({ min: 1 })
        .withMessage("Page must be a positive integer"),

    query("limit")
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage("Limit must be between 1 and 50"),

];

export const availableSlotsValidator = [
    query("date")
        .notEmpty()
        .withMessage("date is required")
        .isString()
        .withMessage("date must be a string (YYYY-MM-DD)"),
    query("duration")
        .optional()
        .isInt({ min: 30 })
        .withMessage("duration must be a positive integer (minutes)")
        .custom((value) => {
            if (value % 30 !== 0) {
                throw new Error("duration must be a multiple of 30 minutes");
            }
            return true;
        }),
];
