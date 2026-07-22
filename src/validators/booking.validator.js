import { body, param, query } from "express-validator";

export const createBookingValidator = [
    body("consultantId")
        .notEmpty()
        .withMessage("Consultant ID is required")
        .isMongoId()
        .withMessage("Invalid consultant ID"),

    body("consultantProfileId")
        .notEmpty()
        .withMessage("Consultant profile ID is required")
        .isMongoId()
        .withMessage("Invalid consultant profile ID"),

    body("date")
        .notEmpty()
        .withMessage("Booking date is required")
        .isISO8601()
        .withMessage("Invalid date format"),

    body("time")
        .notEmpty()
        .withMessage("Booking time is required")
        .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
        .withMessage("Invalid time format (HH:MM)"),

    body("duration")
        .notEmpty()
        .withMessage("Duration is required")
        .isInt({ min: 1 })
        .withMessage("Duration must be at least 1 hour"),

    body("amount")
        .notEmpty()
        .withMessage("Amount is required")
        .isFloat({ min: 0 })
        .withMessage("Amount must be a positive number"),

    body("notes")
        .optional()
        .isLength({ max: 500 })
        .withMessage("Notes cannot exceed 500 characters"),
];

export const bookingIdParamValidator = [
    param("id")
        .notEmpty()
        .withMessage("Booking ID is required")
        .isMongoId()
        .withMessage("Invalid booking ID"),
];

export const bookingStatusQueryValidator = [
    query("status")
        .optional()
        .isIn(["pending", "confirmed", "completed", "cancelled"])
        .withMessage("Invalid status value"),
];

export const paginationQueryValidator = [
    query("page")
        .optional()
        .isInt({ min: 1 })
        .withMessage("Page must be a positive integer"),

    query("limit")
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage("Limit must be between 1 and 50"),
];
