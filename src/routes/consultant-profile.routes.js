import { Router } from "express";

import {
    createConsultantProfile,
    getMyConsultantProfile,
    getConsultantProfileById,
    updateConsultantProfile,
    getMyPayoutSettings,
    updateMyPayoutSettings,
    getBanks,
    verifyAccount,
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
    payoutSettingsValidator,
    updatePayoutSettingsValidator,
    bankListValidator,
    verifyAccountValidator,
    consultantSearchValidator,
    availableSlotsValidator,
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

/*
|--------------------------------------------------------------------------
| Protected Routes (CONSULTANT only) - Fixed paths first
|--------------------------------------------------------------------------
*/

const authConsultant = [authenticate({ skipEmailVerification: true }), authorize("CONSULTANT")];

// Availability slots (embedded in profile) - must be before public parameterized routes
router.get("/availability", ...authConsultant, getMyAvailabilitySlots);
router.post("/availability", ...authConsultant, setMyAvailabilitySlots);
router.delete("/availability/:slotId", ...authConsultant, deleteMyAvailabilitySlot);

// Create consultant profile
router.post(
    "/profile",
    ...authConsultant,
    createConsultantProfileValidator,
    validate,
    createConsultantProfile
);

// Get my consultant profile
router.get("/profile", ...authConsultant, getMyConsultantProfile);

// Update my consultant profile
router.patch(
    "/profile",
    ...authConsultant,
    updateConsultantProfileValidator,
    validate,
    updateConsultantProfile
);

// Get my payout settings
router.get("/payout-settings", ...authConsultant, getMyPayoutSettings);

// Update my payout settings
router.patch(
    "/payout-settings",
    ...authConsultant,
    updatePayoutSettingsValidator,
    validate,
    updateMyPayoutSettings
);

// Get bank list
router.get("/payout-settings/banks", ...authConsultant, getBanks);

// Verify bank account
router.get(
    "/payout-settings/verify-account",
    ...authConsultant,
    verifyAccountValidator,
    validate,
    verifyAccount
);

// Delete my consultant profile
router.delete("/profile", ...authConsultant, deleteConsultantProfile);

/*
|--------------------------------------------------------------------------
| Public Routes (parameterized) - after protected fixed routes
|--------------------------------------------------------------------------
*/

// Get public availability slots for a consultant (public)
router.get("/:id/availability", getPublicAvailabilitySlots);

// Get available booking slots for a specific date (public)
router.get(
    "/:profileId/available-slots",
    availableSlotsValidator,
    validate,
    getAvailableSlotsForDate
);

export default router;
