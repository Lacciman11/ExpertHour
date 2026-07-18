import { body, query } from "express-validator";

export const createConsultantProfileValidator = [

    body("bio")
        .notEmpty()
        .withMessage("Bio is required")
        .isLength({ max: 2000 })
        .withMessage("Bio cannot exceed 2000 characters"),

    body("skills")
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
        .isFloat({ min: 0 })
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
        .isFloat({ min: 0 })
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

export const consultantSearchValidator = [

    query("skills")
        .optional()
        .isString()
        .withMessage("Skills must be a comma-separated string"),

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

    query("page")
        .optional()
        .isInt({ min: 1 })
        .withMessage("Page must be a positive integer"),

    query("limit")
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage("Limit must be between 1 and 50"),

];
