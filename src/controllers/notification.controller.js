import mongoose from "mongoose";

import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import ApiError from "../utils/ApiError.js";

import notificationService from "../services/notification.service.js";

// ---------------------------------------------------------------------------
// Notification Controller
// ---------------------------------------------------------------------------

/**
 * Every handler derives the recipient exclusively from `req.user._id`, which
 * is populated by the authentication middleware from the verified access
 * token. No handler ever reads a recipient id from params, query, or body.
 */

/**
 * GET /notifications
 *
 * List the authenticated user's notifications, newest first, paginated.
 */
export const getMyNotifications = asyncHandler(async (req, res) => {

    const { page, limit, unreadOnly } = req.query;

    const result = await notificationService.listForRecipient(req.user._id, {
        page,
        limit,
        unreadOnly: unreadOnly === "true" || unreadOnly === true,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Notifications fetched successfully"
        )
    );

});

/**
 * GET /notifications/unread-count
 *
 * Count the authenticated user's unread notifications.
 */
export const getUnreadCount = asyncHandler(async (req, res) => {

    const count = await notificationService.countUnread(req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            { count },
            "Unread notification count fetched successfully"
        )
    );

});

/**
 * GET /notifications/preferences
 *
 * Return the authenticated user's effective notification preferences.
 */
export const getMyPreferences = asyncHandler(async (req, res) => {

    const preferences = notificationService.getEffectivePreferences(req.user);

    return res.status(200).json(
        new ApiResponse(
            200,
            { preferences },
            "Notification preferences fetched successfully"
        )
    );

});

/**
 * PATCH /notifications/preferences
 *
 * Partially update the authenticated user's notification preferences.
 * Omitted categories and channels retain their existing effective values.
 */
export const updateMyPreferences = asyncHandler(async (req, res) => {

    const preferences = await notificationService.updatePreferences(req.user, req.body);

    return res.status(200).json(
        new ApiResponse(
            200,
            { preferences },
            "Notification preferences updated successfully"
        )
    );

});

/**
 * PATCH /notifications/:id/read
 *
 * Mark one of the authenticated user's notifications as read.
 * Idempotent. Returns 404 when the notification does not exist or belongs to
 * another user.
 */
export const markNotificationAsRead = asyncHandler(async (req, res) => {

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {

        throw new ApiError(400, "Invalid notification ID format");

    }

    const notification = await notificationService.markAsRead(req.user._id, id);

    if (!notification) {

        // Either the notification does not exist, or it belongs to another
        // user. Both are reported identically so existence is not leaked.
        throw new ApiError(404, "Notification not found");

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            { notification },
            "Notification marked as read"
        )
    );

});

/**
 * POST /notifications/read-all
 *
 * Mark every unread notification belonging to the authenticated user as read.
 */
export const markAllNotificationsAsRead = asyncHandler(async (req, res) => {

    const { modifiedCount } = await notificationService.markAllAsRead(req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            { modifiedCount },
            "Notifications marked as read"
        )
    );

});

/**
 * GET /notifications/admin
 *
 * List the authenticated admin's own notifications in the `admin` category.
 *
 * Visibility policy: results are restricted to notifications addressed to the
 * authenticated admin (recipientId === req.user._id) whose category is
 * `admin`. Other users' notifications are never exposed. Route-level
 * `authorize("ADMIN")` enforces the role.
 */
export const getAdminNotifications = asyncHandler(async (req, res) => {

    const { page, limit } = req.query;

    const result = await notificationService.listAdminNotifications(req.user._id, {
        page,
        limit,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Admin notifications fetched successfully"
        )
    );

});
