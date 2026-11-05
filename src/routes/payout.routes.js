import { Router } from "express";

import {
    getMyPayouts,
    getMyPayoutById,
    requestPayout,
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
| Admin Routes
|--------------------------------------------------------------------------
|
| Mounted at "/admin" before the consultant "/:id" catch-all so paths like
| "/admin/all" are not captured as consultant id="admin". Scoping to "/admin"
| ensures the ADMIN role check applies only to admin paths (preserves
| consultant endpoint access and existing external paths).
*/

const adminRouter = Router();

adminRouter.use(authorize("ADMIN"));

adminRouter.get(
    "/all",
    getAllPayouts
);

adminRouter.get(
    "/:id",
    getPayoutById
);

router.use("/admin", adminRouter);

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

router.post(
    "/",
    authorize("CONSULTANT"),
    requestPayout
);

router.get(
    "/:id",
    authorize("CONSULTANT"),
    getMyPayoutById
);

export default router;
