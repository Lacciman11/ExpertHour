import env from "../../config/env.js";

import emailVerificationTokenService
    from "../email-verification-token.service.js";

import emailOutboxService from "../email-outbox.service.js";

import { EMAIL_TEMPLATE_ID, NOTIFICATION_CATEGORY } from "../../utils/constants.js";

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

        const verificationToken =
            await emailVerificationTokenService.create({
                userId: user._id,
                tokenHash,
                expiresAt,
            });

        const verificationUrl =
            `${env.appUrl}/api/v1/auth/verify-email?token=${rawToken}`;

        // Queue the verification email for asynchronous delivery. The token is
        // already persisted, so a queue failure is logged for operators and
        // does not change the resend response.
        //
        // The dedupe key uses the token document id, which is unique per
        // token generation: a legitimate repeat request rotates the token and
        // therefore produces a distinct key, so it is never incorrectly
        // deduplicated against an earlier email.
        try {

            await emailOutboxService.enqueue({

                recipientId: user._id,

                to: user.email,

                category: NOTIFICATION_CATEGORY.ACCOUNT,

                templateId: EMAIL_TEMPLATE_ID.VERIFY_EMAIL,

                templateData: {
                    firstName: user.firstName,
                    verificationUrl,
                },

                dedupeKey: `verify-email:${user._id}:${verificationToken._id}`,

            });

        } catch (error) {

            console.error(
                "Failed to queue verification email:",
                {
                    userId: user._id.toString(),
                    error: error?.message || error,
                }
            );

        }

    }

}


export default new VerifyEmailService();
