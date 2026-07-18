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

];

export const changePasswordValidator = [

    body("currentPassword")
        .notEmpty()
        .withMessage("Current password is required"),

    body("newPassword")
        .isLength({ min: 8 })
        .withMessage("New password must be at least 8 characters"),

];
