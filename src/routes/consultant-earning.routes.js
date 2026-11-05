import { Router } from "express";

import {
    getMyEarnings,
    getMyEarningById,
    exportMyEarnings,
    getAllEarnings,
    getEarningById,
    verifyEarningConsistency,
} from "../controllers/consultant-earning.controller.js";

import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/role.middleware.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| All earning routes require authentication
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
    getAllEarnings
);

adminRouter.get(
    "/consistency",
    verifyEarningConsistency
);

adminRouter.get(
    "/consistency/:id",
    verifyEarningConsistency
);

adminRouter.get(
    "/:id",
    getEarningById
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
    getMyEarnings
);

router.get(
    "/export",
    authorize("CONSULTANT"),
    exportMyEarnings
);

router.get(
    "/:id",
    authorize("CONSULTANT"),
    getMyEarningById
);

export default router;
