import { Router } from "express";
import rateLimit from "express-rate-limit";

import {
    register,
    login,
    forgotPassword,
    resetPassword,
    logout,

} from "../controllers/index.js";

import {
    registerValidator,
    loginValidator,
    forgotPasswordValidator,
    resetPasswordValidator,
    logoutValidator,

} from "../validators/auth.validator.js";

import validate from "../middlewares/validate.middleware.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Rate Limiting (brute-force / abuse protection)
|
| Each endpoint gets its own bucket so a user logging in repeatedly cannot
| exhaust the budget for requesting a password reset or logging out.
|--------------------------------------------------------------------------
*/

const createLimiter = (max) =>
    rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max, // limit each IP to `max` requests per window
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            message: "Too many attempts, please try again later.",
        },
    });

const registerLimiter = createLimiter(10);
const loginLimiter = createLimiter(10);
const forgotPasswordLimiter = createLimiter(5);
const resetPasswordLimiter = createLimiter(10);
const logoutLimiter = createLimiter(10);

/*
|--------------------------------------------------------------------------
| Authentication
|--------------------------------------------------------------------------
*/

router.post(
    "/register",
    registerLimiter,
    registerValidator,
    validate,
    register
);

router.post(
    "/login",
    loginLimiter,
    loginValidator,
    validate,
    login
);

router.post(
    "/forgot-password",
    forgotPasswordLimiter,
    forgotPasswordValidator,
    validate,
    forgotPassword
);

router.post(
    "/reset-password",
    resetPasswordLimiter,
    resetPasswordValidator,
    validate,
    resetPassword
);

router.post(
    "/logout",
    logoutLimiter,
    logoutValidator,
    validate,
    logout
);

export default router;