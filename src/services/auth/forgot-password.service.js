import env from "../../config/env.js";

import User from "../../models/User.js";

import passwordResetTokenService from "../password-reset-token.service.js";

import emailService from "../email/index.js";

import forgotPasswordTemplate from "../email/templates/forgot-password.template.js";

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

        await passwordResetTokenService.create({

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
            `${env.appUrl}/auth/reset-password?token=${rawToken}`;

        /*
        |--------------------------------------------------------------------------
        | Send Email
        |--------------------------------------------------------------------------
        |
        | Swallow delivery errors so the response stays uniform and does not
        | leak whether an account exists (email enumeration). The token has
        | already been persisted above; a failed send is logged for retry.
        */

        try {

            await emailService.send({

                to: user.email,

                subject: "Reset your ExpertHour password",

                html: forgotPasswordTemplate({

                    firstName: user.firstName,

                    resetUrl,

                }),

            });

        } catch (error) {

            /*
            |------------------------------------------------------------------
            | Delivery failed
            |
            | The token is already persisted, so we keep the generic success
            | response to avoid email enumeration. We log with enough context
            | (user id + email) so ops can alert/retry. The error is NOT
            | re-thrown: the client must receive the same uniform response
            | whether or not the email was delivered.
            |------------------------------------------------------------------
            */

            console.error(
                "Failed to send password reset email:",
                {
                    userId: user._id.toString(),
                    email: user.email,
                    error: error?.message || error,
                }
            );

        }

    }

}

export default new ForgotPasswordService();