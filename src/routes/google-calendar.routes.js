import { Router } from "express";

import {
    getGoogleAuthUrl,
    handleGoogleCallback,
    disconnectGoogleCalendar,
} from "../controllers/google-calendar.controller.js";

import authenticate from "../middlewares/auth.middleware.js";

const router = Router();

router.get("/auth-url", authenticate, getGoogleAuthUrl);

router.post("/callback", authenticate, handleGoogleCallback);

router.post("/disconnect", authenticate, disconnectGoogleCalendar);

export default router;
