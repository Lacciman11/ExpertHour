import { Router } from "express";

import {
    getMyAvailability,
    setAvailability,
    getConsultantAvailability,
    deleteAvailabilitySlot,
    getAvailableSlots,
} from "../controllers/availability.controller.js";

import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/role.middleware.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Consultant Routes (CONSULTANT only) — require authentication
|--------------------------------------------------------------------------
*/

const consultantRouter = Router();

consultantRouter.use(authenticate, authorize("CONSULTANT"));

consultantRouter.get("/", getMyAvailability);

consultantRouter.post("/", setAvailability);

consultantRouter.delete("/:id", deleteAvailabilitySlot);

consultantRouter.get("/slots", getAvailableSlots);

router.use("/consultant", consultantRouter);

/*
|--------------------------------------------------------------------------
| Public Routes — no authentication required
|--------------------------------------------------------------------------
*/

router.get("/:id", getConsultantAvailability);

router.get("/:id/slots", getAvailableSlots);

export default router;
