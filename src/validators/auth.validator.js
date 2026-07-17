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


export const logoutValidator = [

    body("refreshToken")

        .notEmpty()

        .withMessage("Refresh token is required"),

];
