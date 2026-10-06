import { body } from "express-validator";

import { EXPERIENCE_OPTIONS, EXPERTISE_OPTIONS, INDUSTRY_OPTIONS } from "../utils/constants.js";

const applicationValidation = [

    body("fullName")
        .trim()
        .notEmpty().withMessage("Full name is required")
        .isLength({ min: 2, max: 100 }).withMessage("Full name must be between 2 and 100 characters"),

    body("email")
        .trim()
        .notEmpty().withMessage("Email is required")
        .isEmail().withMessage("Please provide a valid email address")
        .isLength({ max: 100 }).withMessage("Email cannot exceed 100 characters"),

    body("phone")
        .trim()
        .notEmpty().withMessage("Phone number is required")
        .isLength({ max: 20 }).withMessage("Phone number cannot exceed 20 characters"),

    body("linkedinProfile")
        .trim()
        .notEmpty().withMessage("LinkedIn profile is required")
        .isURL().withMessage("Please provide a valid LinkedIn profile URL")
        .isLength({ max: 200 }).withMessage("LinkedIn profile URL cannot exceed 200 characters"),

    body("currentTitle")
        .trim()
        .notEmpty().withMessage("Current title is required")
        .isLength({ max: 100 }).withMessage("Current title cannot exceed 100 characters"),

    body("organisation")
        .trim()
        .isLength({ max: 100 }).withMessage("Organisation name cannot exceed 100 characters"),

    body("yearsExperience")
        .trim()
        .notEmpty().withMessage("Years of experience is required")
        .isIn(EXPERIENCE_OPTIONS).withMessage("Please select a valid years of experience"),

    body("primaryIndustry")
        .custom((value) => {

            if (value === undefined || value === null || value === "") {

                throw new Error("Primary industry is required");

            }

            let parsed = value;

            if (typeof value === "string") {

                try {

                    parsed = JSON.parse(value);

                } catch {

                    throw new Error("Primary industry must be a valid JSON array");

                }

            }

            if (!Array.isArray(parsed)) {

                throw new Error("Primary industry must be an array");

            }

            if (parsed.length === 0) {

                throw new Error("Please select at least one primary industry");

            }

            for (const item of parsed) {

                if (!INDUSTRY_OPTIONS.includes(item)) {

                    throw new Error(`Invalid industry option: ${item}`);

                }

            }

            return true;

        }),

    body("primaryExpertise")
        .trim()
        .notEmpty().withMessage("Primary expertise is required")
        .isLength({ max: 100 }).withMessage("Primary expertise cannot exceed 100 characters")
        .isIn(EXPERTISE_OPTIONS).withMessage("Please select a valid primary expertise"),

    body("otherExpertise")
        .optional()
        .custom((value) => {

            if (value === undefined || value === null || value === "") {

                return true;

            }

            let parsed = value;

            if (typeof value === "string") {

                try {

                    parsed = JSON.parse(value);

                } catch {

                    throw new Error("Other expertise must be a valid JSON array");

                }

            }

            if (!Array.isArray(parsed)) {

                throw new Error("Other expertise must be an array");

            }

            for (const item of parsed) {

                if (!EXPERTISE_OPTIONS.includes(item)) {

                    throw new Error(`Invalid expertise option: ${item}`);

                }

            }

            return true;

        }),

    body("notableAchievement")
        .trim()
        .notEmpty().withMessage("Please share a notable professional achievement")
        .isLength({ max: 1000 }).withMessage("Notable achievement cannot exceed 1000 characters"),

    body("businessChallenge")
        .trim()
        .notEmpty().withMessage("Please share a significant business challenge you have helped solve")
        .isLength({ max: 1000 }).withMessage("Business challenge cannot exceed 1000 characters"),

    body("certifications")
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage("Certifications cannot exceed 500 characters"),

    body("industryContributions")
        .optional()
        .trim()
        .isLength({ max: 1000 }).withMessage("Industry contributions cannot exceed 1000 characters"),

    body("projectsConsultingEvidence")
        .optional()
        .trim()
        .isLength({ max: 1000 }).withMessage("Projects / consulting evidence cannot exceed 1000 characters"),

    body("whyJoin")
        .trim()
        .notEmpty().withMessage("Please tell us why you would like to join")
        .isLength({ max: 1000 }).withMessage("Why join cannot exceed 1000 characters"),

    body("additionalInfo")
        .optional()
        .trim()
        .isLength({ max: 500 }).withMessage("Additional info cannot exceed 500 characters"),

    body("consent")
        .trim()
        .notEmpty().withMessage("Consent is required")
        .isIn(["Yes"]).withMessage("Consent must be Yes"),

];

export default applicationValidation;
