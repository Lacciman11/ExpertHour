import env from "../../config/env.js";

import emailVerificationTokenService
    from "../email-verification-token.service.js";

import emailService from "../email/index.js";

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

        await emailVerificationTokenService.markAsVerified(tokenDoc._id);

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

        await emailService.send({

            to: user.email,

            subject: "Verify your ExpertHour email",

            html: verifyEmailTemplate({

                firstName: user.firstName,

                verificationUrl,

            }),

        });

    }

}


export default new VerifyEmailService();
