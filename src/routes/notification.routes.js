import { Router } from "express";

import {
    getMyNotifications,
    getUnreadCount,
    getMyPreferences,
    updateMyPreferences,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    getAdminNotifications,
} from "../controllers/notification.controller.js";

import {
    notificationPaginationQueryValidator,
    notificationIdParamValidator,
    notificationPreferencesValidator,
} from "../validators/notification.validator.js";

import validate from "../middlewares/validate.middleware.js";
import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/role.middleware.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| All notification routes require authentication
|--------------------------------------------------------------------------
|
| `skipEmailVerification: true` follows the profile/consultant-profile
| convention: an unverified user can still read their notifications (they
| need them to complete verification). The recipient is always taken from
| `req.user._id` inside each handler — never from params, query, or body.
*/

router.use(authenticate({ skipEmailVerification: true }));

/*
|--------------------------------------------------------------------------
| Preferences
|--------------------------------------------------------------------------
|
| Declared before "/:id" so the literal segment is not captured as an id.
*/

router.get(
    "/preferences",
    getMyPreferences
);

router.patch(
    "/preferences",
    notificationPreferencesValidator,
    validate,
    updateMyPreferences
);

/*
|--------------------------------------------------------------------------
| Unread count
|--------------------------------------------------------------------------
*/

router.get(
    "/unread-count",
    getUnreadCount
);

/*
|--------------------------------------------------------------------------
| Mark all as read
|--------------------------------------------------------------------------
*/

router.post(
    "/read-all",
    markAllNotificationsAsRead
);

/*
|--------------------------------------------------------------------------
| Admin notifications
|--------------------------------------------------------------------------
|
| Restricted to the ADMIN role. Results are additionally scoped to the
| authenticated admin's own `admin`-category notifications inside the
| service, so other users' notifications are never exposed.
*/

router.get(
    "/admin",
    authorize("ADMIN"),
    notificationPaginationQueryValidator,
    validate,
    getAdminNotifications
);

/*
|--------------------------------------------------------------------------
| List my notifications
|--------------------------------------------------------------------------
*/

router.get(
    "/",
    notificationPaginationQueryValidator,
    validate,
    getMyNotifications
);

/*
|--------------------------------------------------------------------------
| Mark one as read
|--------------------------------------------------------------------------
*/

router.patch(
    "/:id/read",
    notificationIdParamValidator,
    validate,
    markNotificationAsRead
);

export default router;
