import { Router } from "express";

import {
    getMyPayouts,
    getMyPayoutById,
    getAllPayouts,
    getPayoutById,
} from "../controllers/payout.controller.js";

import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/role.middleware.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| All payout routes require authentication
|--------------------------------------------------------------------------
*/

router.use(authenticate());

/*
|--------------------------------------------------------------------------
| Consultant Routes
|--------------------------------------------------------------------------
*/

router.get(
    "/",
    authorize("CONSULTANT"),
    getMyPayouts
);

router.get(
    "/:id",
    authorize("CONSULTANT"),
    getMyPayoutById
);

/*
|--------------------------------------------------------------------------
| Admin Routes
|--------------------------------------------------------------------------
*/

const adminRouter = Router();

adminRouter.use(authorize("ADMIN"));

adminRouter.get(
    "/admin/all",
    getAllPayouts
);

adminRouter.get(
    "/admin/:id",
    getPayoutById
);

router.use(adminRouter);

export default router;
