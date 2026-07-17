import { Router } from "express";
import rateLimit from "express-rate-limit";

import {
    renderResetPasswordPage,
    renderResetSuccessPage,
} from "../controllers/index.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Rate Limiting
|
| Prevents high-volume probing of token validity via the page endpoint.
|--------------------------------------------------------------------------
*/

const pageLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // limit each IP to 30 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many attempts, please try again later.",
    },
});

router.get(
    "/reset-password",
    pageLimiter,
    renderResetPasswordPage
);

router.get(
    "/reset-success",
    pageLimiter,
    renderResetSuccessPage
);

export default router;
