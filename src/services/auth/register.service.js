import env from "../../config/env.js";

import ApiError from "../../utils/ApiError.js";

import userService from "../user.service.js";
import tokenService from "../token.service.js";
import sessionService from "../session.service.js";
import emailVerificationTokenService
    from "../email-verification-token.service.js";
import emailService from "../email/index.js";
import verifyEmailTemplate
    from "../email/templates/verify-email.template.js";

const register = async ({
    firstName,
    lastName,
    email,
    password,
    role,
    ipAddress,
    userAgent,
    deviceName,
}) => {

    const existingUser = await userService.findByEmail(email);

    if (existingUser) {
        throw new ApiError(409, "Email already exists");
    }

    const user = await userService.create({
        firstName,
        lastName,
        email,
        password,
        role,
    });

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

    const payload = {
        userId: user._id,
        role: user.role,
    };

    const accessToken =
        tokenService.generateAccessToken(payload);

    const refreshToken =
        tokenService.generateRefreshToken(payload);

    const decoded =
        tokenService.verifyRefreshToken(refreshToken);

    await sessionService.createSession({
        userId: user._id,
        refreshToken,
        expiresAt: new Date(decoded.exp * 1000),
        ipAddress,
        userAgent,
        deviceName,
    });

    return {
        user,
        accessToken,
        refreshToken,
    };
};

export default register;