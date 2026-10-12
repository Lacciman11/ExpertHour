import env from "../../config/env.js";

import User from "../../models/User.js";

import passwordResetTokenService from "../password-reset-token.service.js";

import emailOutboxService from "../email-outbox.service.js";

import { EMAIL_TEMPLATE_ID, NOTIFICATION_CATEGORY } from "../../utils/constants.js";

class ForgotPasswordService {

    async execute(email) {

        const user = await User.findOne({
            email: email.toLowerCase(),
        });

        /*
        |--------------------------------------------------------------------------
        | Prevent Email Enumeration
        |--------------------------------------------------------------------------
        */

        if (!user) {

            return;

        }

        /*
        |--------------------------------------------------------------------------
        | Generate Token
        |--------------------------------------------------------------------------
        */

        const {

            rawToken,

            tokenHash,

        } = passwordResetTokenService.generateToken();

        /*
        |--------------------------------------------------------------------------
        | Save Token
        |--------------------------------------------------------------------------
        */

        const expiresAt = new Date(
            Date.now() + 15 * 60 * 1000
        );

        const resetToken = await passwordResetTokenService.create({

            userId: user._id,

            tokenHash,

            expiresAt,

        });

        /*
        |--------------------------------------------------------------------------
        | Build Reset URL
        |--------------------------------------------------------------------------
        */

        const resetUrl =
            `${env.appUrl}/reset-password?token=${rawToken}`;

        /*
        |--------------------------------------------------------------------------
        | Queue Email
        |--------------------------------------------------------------------------
        |
        | Delivery is asynchronous and owned by the outbox worker. Enqueue
        | failures are swallowed so the response stays uniform and does not
        | leak whether an account exists (email enumeration). The token has
        | already been persisted above, so a failed enqueue is logged for ops
        | to retry; the client receives the same generic response either way.
        |
        | The dedupe key uses the token document id, which is unique per token
        | generation and contains no token material. A legitimate repeat
        | request rotates the token and therefore produces a distinct key.
        |
        | The reset URL and token are never logged.
        */

        try {

            await emailOutboxService.enqueue({

                recipientId: user._id,

                to: user.email,

                category: NOTIFICATION_CATEGORY.ACCOUNT,

                templateId: EMAIL_TEMPLATE_ID.FORGOT_PASSWORD,

                templateData: {
                    firstName: user.firstName,
                    resetUrl,
                },

                dedupeKey: `forgot-password:${user._id}:${resetToken._id}`,

            });

        } catch (error) {

            console.error(
                "Failed to queue password reset email:",
                {
                    userId: user._id.toString(),
                    error: error?.message || error,
                }
            );

        }

    }

}

export default new ForgotPasswordService();