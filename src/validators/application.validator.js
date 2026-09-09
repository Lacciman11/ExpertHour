import { body } from "express-validator";

export const applicationValidator = [
    body("fullName")
        .trim()
        .notEmpty()
        .withMessage("Full name is required")
        .isLength({ min: 2, max: 100 })
        .withMessage("Full name must be between 2 and 100 characters"),

    body("email")
        .trim()
        .isEmail()
        .withMessage("Please provide a valid email address")
        .normalizeEmail(),

    body("phone")
        .trim()
        .notEmpty()
        .withMessage("Phone number is required")
        .isLength({ max: 20 })
        .withMessage("Phone number cannot exceed 20 characters"),

    body("linkedinProfile")
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage("LinkedIn profile URL cannot exceed 200 characters")
        .isURL()
        .withMessage("Please provide a valid LinkedIn profile URL"),

    body("currentTitle")
        .trim()
        .notEmpty()
        .withMessage("Current title is required")
        .isLength({ max: 100 })
        .withMessage("Current title cannot exceed 100 characters"),

    body("organisation")
        .trim()
        .notEmpty()
        .withMessage("Organisation name is required")
        .isLength({ max: 100 })
        .withMessage("Organisation name cannot exceed 100 characters"),

    body("yearsExperience")
        .trim()
        .notEmpty()
        .withMessage("Years of experience is required"),

    body("primaryIndustry")
        .trim()
        .notEmpty()
        .withMessage("Primary industry is required"),

    body("primaryIndustryOther")
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage("Primary industry other cannot exceed 100 characters"),

    body("primaryExpertise")
        .trim()
        .notEmpty()
        .withMessage("Primary expertise is required"),

    body("primaryExpertiseOther")
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage("Primary expertise other cannot exceed 100 characters"),

    body("otherExpertise")
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage("Other expertise cannot exceed 100 characters"),

    body("otherExpertiseOther")
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage("Other expertise other cannot exceed 100 characters"),

    body("notableAchievement")
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage("Notable achievement cannot exceed 500 characters"),

    body("businessChallenge")
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage("Business challenge cannot exceed 500 characters"),

    body("certifications")
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage("Certifications cannot exceed 500 characters"),

    body("whyJoin")
        .trim()
        .notEmpty()
        .withMessage("Please tell us why you would like to join")
        .isLength({ max: 500 })
        .withMessage("Why join cannot exceed 500 characters"),

    body("additionalInfo")
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage("Additional info cannot exceed 500 characters"),

    body("consent")
        .trim()
        .notEmpty()
        .withMessage("Consent is required")
        .isIn(["Yes", "No"])
        .withMessage("Consent must be Yes or No"),
];
