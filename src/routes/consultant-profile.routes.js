import { Router } from "express";

import {
    createConsultantProfile,
    getMyConsultantProfile,
    getConsultantProfileById,
    updateConsultantProfile,
    searchConsultants,
    deleteConsultantProfile,
    getMyAvailabilitySlots,
    setMyAvailabilitySlots,
    deleteMyAvailabilitySlot,
    getPublicAvailabilitySlots,
    getAvailableSlotsForDate,
} from "../controllers/consultant-profile.controller.js";

import {
    createConsultantProfileValidator,
    updateConsultantProfileValidator,
    consultantSearchValidator,
} from "../validators/consultant-profile.validator.js";

import validate from "../middlewares/validate.middleware.js";
import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/role.middleware.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Public Routes
|--------------------------------------------------------------------------
*/

// Search consultants (public)
router.get(
    "/",
    consultantSearchValidator,
    validate,
    searchConsultants
);

// Get consultant profile by ID (public)
router.get("/id/:id", getConsultantProfileById);

// Get public availability slots for a consultant (public)
router.get("/:id/availability", getPublicAvailabilitySlots);

// Get available booking slots for a specific date (public)
router.get("/:profileId/available-slots", getAvailableSlotsForDate);

/*
|--------------------------------------------------------------------------
| Protected Routes (CONSULTANT only)
|--------------------------------------------------------------------------
*/

const protectedRouter = Router();

protectedRouter.use(authenticate);
protectedRouter.use(authorize("CONSULTANT"));

// Create consultant profile
protectedRouter.post(
    "/profile",
    createConsultantProfileValidator,
    validate,
    createConsultantProfile
);

// Get my consultant profile
protectedRouter.get("/profile", getMyConsultantProfile);

// Update my consultant profile
protectedRouter.patch(
    "/profile",
    updateConsultantProfileValidator,
    validate,
    updateConsultantProfile
);

// Delete my consultant profile
protectedRouter.delete("/profile", deleteConsultantProfile);

// Availability slots (embedded in profile)
protectedRouter.get("/availability", getMyAvailabilitySlots);
protectedRouter.post("/availability", setMyAvailabilitySlots);
protectedRouter.delete("/availability/:index", deleteMyAvailabilitySlot);

router.use(protectedRouter);

export default router;
