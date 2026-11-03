import { Router } from "express";
import { rateLimit } from "express-rate-limit";

import {
    getDashboardStats,
    getPaymentStats,
    getPaymentRecoveryReport,
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
    manualReconcilePayment,
} from "../controllers/admin.controller.js";

import {
    adminPaginationQueryValidator,
    adminSearchQueryValidator,
    adminStatusQueryValidator,
    adminUserIdParamValidator,
    adminProfileIdParamValidator,
    changeRoleBodyValidator,
    adminReferenceParamValidator,
} from "../validators/admin.validator.js";

import validate from "../middlewares/validate.middleware.js";
import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/role.middleware.js";

const router = Router();

/*
 |--------------------------------------------------------------------------
 | Rate limiters
 |--------------------------------------------------------------------------
 |
 | Manual payment reconciliation touches Paystack verification, so it is
 | rate-limited per admin user to prevent accidental or malicious retry
 | storms. The window matches the payment verification limiter.
 */
const manualReconcileLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // 30 requests per 15 minutes per admin
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user ? req.user._id.toString() : req.ip,
    message: {
        success: false,
        message: "Too many reconciliation requests. Please try again later.",
    },
});

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

router.get("/payments/recovery-report", getPaymentRecoveryReport);

router.post(
    "/payments/:reference/reconcile",
    adminReferenceParamValidator,
    validate,
    manualReconcileLimiter,
    manualReconcilePayment
);

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
