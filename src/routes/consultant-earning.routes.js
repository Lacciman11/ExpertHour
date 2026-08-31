import { Router } from "express";

import {
    getMyEarnings,
    getMyEarningById,
    getAllEarnings,
    getEarningById,
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
| Consultant Routes
|--------------------------------------------------------------------------
*/

router.get(
    "/",
    authorize("CONSULTANT"),
    getMyEarnings
);

router.get(
    "/:id",
    authorize("CONSULTANT"),
    getMyEarningById
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
    getAllEarnings
);

adminRouter.get(
    "/admin/:id",
    getEarningById
);

router.use(adminRouter);

export default router;
