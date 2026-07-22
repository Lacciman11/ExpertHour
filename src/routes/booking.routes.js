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
    getAllBookings,
    getPendingRequests,
    getConsultantUpcomingSessions,
    getEarningsSummary,
    acceptBooking,
    declineBooking,
} from "../controllers/booking.controller.js";

import {
    createBookingValidator,
    bookingIdParamValidator,
    bookingStatusQueryValidator,
    paginationQueryValidator,
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

router.use(authenticate);

/*
|--------------------------------------------------------------------------
| Client Routes
|--------------------------------------------------------------------------
*/

router.post(
    "/",
    createBookingValidator,
    validate,
    createBooking
);

router.get(
    "/",
    bookingStatusQueryValidator,
    paginationQueryValidator,
    validate,
    getMyBookings
);

router.get(
    "/upcoming",
    getUpcomingBookings
);

router.get(
    "/:id",
    bookingIdParamValidator,
    validate,
    getBookingById
);

router.patch(
    "/:id/cancel",
    bookingIdParamValidator,
    validate,
    cancelBooking
);

/*
|--------------------------------------------------------------------------
| Consultant Routes
|--------------------------------------------------------------------------
*/

const consultantRouter = Router();

consultantRouter.use(authenticate);
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

router.use("/consultant", consultantRouter);

/*
|--------------------------------------------------------------------------
| Admin Routes
|--------------------------------------------------------------------------
*/

const adminRouter = Router();

adminRouter.use(authenticate);
adminRouter.use(authorize("ADMIN"));

adminRouter.get(
    "/all",
    bookingStatusQueryValidator,
    paginationQueryValidator,
    validate,
    getAllBookings
);

router.use("/admin", adminRouter);

export default router;
