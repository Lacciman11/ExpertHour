import { body, param, query } from "express-validator";

import { NOTIFICATION_CATEGORY } from "../utils/constants.js";

/**
 * Notification validators.
 *
 * Follows the project convention: express-validator chains exported as arrays
 * and applied with the shared `validate` middleware.
 */

const CATEGORY_VALUES = Object.values(NOTIFICATION_CATEGORY);

/**
 * Pagination for notification listings.
 * Mirrors adminPaginationQueryValidator: page >= 1, limit 1..50.
 */
export const notificationPaginationQueryValidator = [

    query("page")
        .optional()
        .isInt({ min: 1 })
        .withMessage("Page must be a positive integer"),

    query("limit")
        .optional()
        .isInt({ min: 1, max: 50 })
        .withMessage("Limit must be between 1 and 50"),

];

/**
 * :id route parameter must be a valid ObjectId.
 */
export const notificationIdParamValidator = [

    param("id")
        .notEmpty()
        .withMessage("Notification ID is required")
        .isMongoId()
        .withMessage("Invalid notification ID format"),

];

/**
 * Preference update body.
 *
 * Accepts a partial object keyed by the ten supported categories, each with
 * optional `inApp` and `email` booleans. Rejects unknown categories, unknown
 * channel names, malformed objects, and non-boolean values.
 *
 * Mandatory-channel normalisation is applied in the service, not here, so the
 * validator only enforces shape.
 */
export const notificationPreferencesValidator = [

    body()
        .custom((value) => {

            if (!value || typeof value !== "object" || Array.isArray(value)) {

                throw new Error("Preferences must be an object");

            }

            for (const category of Object.keys(value)) {

                if (!CATEGORY_VALUES.includes(category)) {

                    throw new Error(`Unknown notification category: ${category}`);

                }

                const channels = value[category];

                if (!channels || typeof channels !== "object" || Array.isArray(channels)) {

                    throw new Error(`Preferences for "${category}" must be an object`);

                }

                for (const channel of Object.keys(channels)) {

                    if (channel !== "inApp" && channel !== "email") {

                        throw new Error(`Unknown notification channel: ${channel}`);

                    }

                    if (typeof channels[channel] !== "boolean") {

                        throw new Error(`Preference "${category}.${channel}" must be a boolean`);

                    }

                }

            }

            return true;

        }),

];
