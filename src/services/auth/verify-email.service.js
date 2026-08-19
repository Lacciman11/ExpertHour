import env from "../../config/env.js";

import emailVerificationTokenService
    from "../email-verification-token.service.js";

import {emailService} from "../email/index.js";

import verifyEmailTemplate
    from "../email/templates/verify-email.template.js";

import userService from "../user.service.js";

class VerifyEmailService {

    async execute(token) {

        const validation =
            await emailVerificationTokenService.validateToken(token);

        if (!validation.valid) {

            throw new Error(
                validation.reason === "expired"
                    ? "Verification link has expired"
                    : "Invalid verification link"
            );

        }

        const { token: tokenDoc } = validation;

        const user = tokenDoc.user;

        await emailVerificationTokenService.deleteUserTokens(user._id);

        await userService.update(user._id, {
            isVerified: true,
        });

    }

    async resend(email) {

        const user = await userService.findByEmail(email);

        if (!user) {

            return;

        }

        if (user.isVerified) {

            throw new Error("Email is already verified");

        }

        const {
            rawToken,
            tokenHash,
        } = emailVerificationTokenService.generateToken();

        const expiresAt = new Date(
            Date.now() + 24 * 60 * 60 * 1000
        );

        await emailVerificationTokenService.create({
            userId: user._id,
            tokenHash,
            expiresAt,
        });

        const verificationUrl =
            `${env.appUrl}/api/v1/auth/verify-email?token=${rawToken}`;

        // Send email in the background so the response is not blocked by SMTP timeouts
        const sendVerificationEmail = async () => {

            try {

                await emailService.send({

                    to: user.email,

                    subject: "Verify your ExpertHour email",

                    html: verifyEmailTemplate({

                        firstName: user.firstName,

                        verificationUrl,

                    }),

                });

            } catch (error) {

                console.error(

                    "Failed to send verification email:",

                    {

                        userId: user._id.toString(),

                        email: user.email,

                        error: error?.message || error,

                    }

                );

            }

        };

        sendVerificationEmail();

    }

}


export default new VerifyEmailService();
