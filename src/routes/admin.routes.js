import { Router } from "express";

import {
    getDashboardStats,
    getPaymentStats,
    getAllPayments,
    getAllUsers,
    getAllConsultants,
    getPendingConsultants,
    getAllBookings,
    getReportsData,
    getTopPerformers,
    banUser,
    unbanUser,
    approveConsultant,
    rejectConsultant,
    suspendConsultant,
    activateConsultant,
    changeUserRole,
} from "../controllers/admin.controller.js";

import {
    adminPaginationQueryValidator,
    adminSearchQueryValidator,
    adminStatusQueryValidator,
    adminUserIdParamValidator,
    adminProfileIdParamValidator,
    changeRoleBodyValidator,
} from "../validators/admin.validator.js";

import validate from "../middlewares/validate.middleware.js";
import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/role.middleware.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| All admin routes require authentication + ADMIN role
|--------------------------------------------------------------------------
*/

router.use(authenticate());
router.use(authorize("ADMIN"));

/*
|--------------------------------------------------------------------------
| Dashboard Stats
|--------------------------------------------------------------------------
*/

router.get("/stats", getDashboardStats);

/*
|--------------------------------------------------------------------------
| Payments
|--------------------------------------------------------------------------
*/

router.get("/payments/stats", getPaymentStats);

router.get("/payments", getAllPayments);

/*
|--------------------------------------------------------------------------
| Users
|--------------------------------------------------------------------------
*/

router.get(
    "/users",
    adminSearchQueryValidator,
    adminStatusQueryValidator,
    adminPaginationQueryValidator,
    validate,
    getAllUsers
);

router.patch(
    "/users/:userId/ban",
    adminUserIdParamValidator,
    validate,
    banUser
);

router.patch(
    "/users/:userId/unban",
    adminUserIdParamValidator,
    validate,
    unbanUser
);

router.patch(
    "/users/:userId/role",
    adminUserIdParamValidator,
    changeRoleBodyValidator,
    validate,
    changeUserRole
);

/*
|--------------------------------------------------------------------------
| Consultants
|--------------------------------------------------------------------------
*/

router.get(
    "/consultants",
    adminSearchQueryValidator,
    adminStatusQueryValidator,
    adminPaginationQueryValidator,
    validate,
    getAllConsultants
);

router.get("/consultants/pending", getPendingConsultants);

router.patch(
    "/consultants/:profileId/approve",
    adminProfileIdParamValidator,
    validate,
    approveConsultant
);

router.patch(
    "/consultants/:profileId/reject",
    adminProfileIdParamValidator,
    validate,
    rejectConsultant
);

router.patch(
    "/consultants/:profileId/suspend",
    adminProfileIdParamValidator,
    validate,
    suspendConsultant
);

router.patch(
    "/consultants/:profileId/activate",
    adminProfileIdParamValidator,
    validate,
    activateConsultant
);

/*
|--------------------------------------------------------------------------
| Bookings
|--------------------------------------------------------------------------
*/

router.get(
    "/bookings",
    adminSearchQueryValidator,
    adminStatusQueryValidator,
    adminPaginationQueryValidator,
    validate,
    getAllBookings
);

/*
|--------------------------------------------------------------------------
| Reports
|--------------------------------------------------------------------------
*/

router.get("/reports", getReportsData);

router.get("/top-performers", getTopPerformers);

export default router;
