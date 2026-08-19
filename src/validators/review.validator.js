import { body, param, query } from "express-validator";

export const createReviewValidator = [
    body("bookingId")
        .notEmpty()
        .withMessage("Booking ID is required")
        .isMongoId()
        .withMessage("Invalid booking ID"),

    body("rating")
        .notEmpty()
        .withMessage("Rating is required")
        .isInt({ min: 1, max: 5 })
        .withMessage("Rating must be between 1 and 5"),

    body("comment")
        .optional()
        .isLength({ max: 1000 })
        .withMessage("Comment cannot exceed 1000 characters"),
];

export const reviewQueryValidator = [
    query("page")
        .optional()
        .isInt({ min: 1 })
        .withMessage("Page must be a positive integer"),

    query("limit")
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage("Limit must be between 1 and 50"),
];
