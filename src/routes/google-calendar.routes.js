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

// GET: Google OAuth 2.0 secure redirect target. Google sends the authorization
// code directly to the backend, which exchanges it server-side and then
// redirects the browser to the frontend callback page.
// Authentication is not required here because the callback derives the
// consultant identity from the verified OAuth state parameter.
router.get("/callback", handleGoogleCallback);

// POST: Legacy frontend-mediated callback. Retained for backward compatibility
// but the frontend should migrate to the GET flow to comply with Google's
// secure response handling policy.
router.post("/callback", authenticate(), authorize("CONSULTANT"), handleGoogleCallback);

router.post("/disconnect", authenticate(), authorize("CONSULTANT"), disconnectGoogleCalendar);

export default router;
