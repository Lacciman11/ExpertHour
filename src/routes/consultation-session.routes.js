import { Router } from "express";

import {
    createOrUpdateSession,
    getSessionByBookingId,
    recordAttendanceSignal,
    addRecordingUrl,
} from "../controllers/consultation-session.controller.js";

import validate from "../middlewares/validate.middleware.js";
import authenticate from "../middlewares/auth.middleware.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| All session routes require authentication
|--------------------------------------------------------------------------
*/

router.use(authenticate());

/*
|--------------------------------------------------------------------------
| Session Management Routes
|--------------------------------------------------------------------------
*/

// Create or update session notes/recording
router.put(
    "/booking/:bookingId",
    createOrUpdateSession
);

// Get session details for a booking
router.get(
    "/booking/:bookingId",
    getSessionByBookingId
);

// Participant attendance signal (join / leave only — terminal statuses are rejected)
router.patch(
    "/booking/:bookingId/attendance",
    recordAttendanceSignal
);

// Add recording URL (consultant only)
router.post(
    "/booking/:bookingId/recording",
    addRecordingUrl
);

export default router;
