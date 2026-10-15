import { Router } from "express";

import {
    createBooking,
    getMyBookings,
    getUpcomingBookings,
    getBookingById,
    cancelBooking,
    confirmBooking,
    completeBooking,
    getConsultantStats,
    getClientStats,
    getAllBookings,
    getPendingRequests,
    getConsultantUpcomingSessions,
    getConsultantBookings,
    getEarningsSummary,
    acceptBooking,
    declineBooking,
} from "../controllers/booking.controller.js";

import {
    createBookingValidator,
    bookingIdParamValidator,
    bookingStatusQueryValidator,
    paginationQueryValidator,
    cancelBookingValidator,
} from "../validators/booking.validator.js";

import validate from "../middlewares/validate.middleware.js";
import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/role.middleware.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| All booking routes require authentication
|--------------------------------------------------------------------------
*/

router.use(authenticate());

/*
|--------------------------------------------------------------------------
| Client Routes
|--------------------------------------------------------------------------
|
| Registered directly on the booking router instead of inside a sub-router
| mounted at "/". A sub-router mounted at "/" is a catch-all: its pathless
| `authorize("BUSINESS_OWNER")` runs for EVERY booking path — including
| /consultant/* and /admin/* — so consultant and admin requests were rejected
| before their own routers were ever reached. Applying the role check per
| route preserves client-only authorization without shadowing the others.
|
| The top-level `authenticate()` above already covers these routes, so no
| per-route authentication middleware is required.
*/

router.post(
    "/",
    authorize("BUSINESS_OWNER"),
    createBookingValidator,
    validate,
    createBooking
);

router.get(
    "/",
    authorize("BUSINESS_OWNER"),
    bookingStatusQueryValidator,
    paginationQueryValidator,
    validate,
    getMyBookings
);

router.get(
    "/upcoming",
    authorize("BUSINESS_OWNER"),
    getUpcomingBookings
);

router.get(
    "/client/stats",
    authorize("BUSINESS_OWNER"),
    getClientStats
);

/*
|--------------------------------------------------------------------------
| Consultant Routes
|--------------------------------------------------------------------------
*/

const consultantRouter = Router();

consultantRouter.use(authenticate());
consultantRouter.use(authorize("CONSULTANT"));

consultantRouter.patch(
    "/:id/confirm",
    bookingIdParamValidator,
    validate,
    confirmBooking
);

consultantRouter.patch(
    "/:id/complete",
    bookingIdParamValidator,
    validate,
    completeBooking
);

consultantRouter.get(
    "/stats",
    getConsultantStats
);

consultantRouter.get(
    "/pending-requests",
    getPendingRequests
);

consultantRouter.get(
    "/upcoming-sessions",
    getConsultantUpcomingSessions
);

consultantRouter.get(
    "/",
    bookingStatusQueryValidator,
    paginationQueryValidator,
    validate,
    getConsultantBookings
);

consultantRouter.get(
    "/earnings-summary",
    getEarningsSummary
);

consultantRouter.patch(
    "/:id/accept",
    bookingIdParamValidator,
    validate,
    acceptBooking
);

consultantRouter.patch(
    "/:id/decline",
    bookingIdParamValidator,
    validate,
    declineBooking
);

/*
|--------------------------------------------------------------------------
| Admin Routes
|--------------------------------------------------------------------------
*/

const adminRouter = Router();

adminRouter.use(authenticate());
adminRouter.use(authorize("ADMIN"));

adminRouter.get(
    "/all",
    bookingStatusQueryValidator,
    paginationQueryValidator,
    validate,
    getAllBookings
);

// Mount the role-specific routers at their explicit prefixes. The client
// routes above are registered directly on this router, so there is no
// catch-all mount that could intercept /consultant/* or /admin/*.
router.use("/consultant", consultantRouter);
router.use("/admin", adminRouter);

router.get(
    "/:id",
    bookingIdParamValidator,
    validate,
    getBookingById
);

router.patch(
    "/:id/cancel",
    bookingIdParamValidator,
    cancelBookingValidator,
    validate,
    cancelBooking
);

export default router;
