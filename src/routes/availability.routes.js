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
| All availability routes require authentication
|--------------------------------------------------------------------------
*/

router.use(authenticate);

/*
|--------------------------------------------------------------------------
| Consultant Routes (CONSULTANT only)
|--------------------------------------------------------------------------
*/

const consultantRouter = Router();

consultantRouter.use(authorize("CONSULTANT"));

consultantRouter.get("/", getMyAvailability);

consultantRouter.post("/", setAvailability);

consultantRouter.delete("/:id", deleteAvailabilitySlot);

consultantRouter.get("/slots", getAvailableSlots);

router.use("/consultant", consultantRouter);

/*
|--------------------------------------------------------------------------
| Public Routes
|--------------------------------------------------------------------------
*/

router.get("/:id", getConsultantAvailability);

router.get("/:id/slots", getAvailableSlots);

export default router;
