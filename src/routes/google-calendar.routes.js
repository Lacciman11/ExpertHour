import { Router } from "express";

import {
    getGoogleAuthUrl,
    handleGoogleCallback,
    disconnectGoogleCalendar,
} from "../controllers/google-calendar.controller.js";

import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/role.middleware.js";

const router = Router();

// All Google Calendar endpoints require CONSULTANT role
router.get("/auth-url", authenticate(), authorize("CONSULTANT"), getGoogleAuthUrl);

router.post("/callback", authenticate(), authorize("CONSULTANT"), handleGoogleCallback);

router.post("/disconnect", authenticate(), authorize("CONSULTANT"), disconnectGoogleCalendar);

export default router;
