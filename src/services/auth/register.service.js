import env from "../../config/env.js";

import ApiError from "../../utils/ApiError.js";

import userService from "../user.service.js";
import tokenService from "../token.service.js";
import sessionService from "../session.service.js";
import emailVerificationTokenService from "../email-verification-token.service.js";
import emailOutboxService from "../email-outbox.service.js";
import { EMAIL_TEMPLATE_ID, NOTIFICATION_CATEGORY } from "../../utils/constants.js";

const register = async ({
    firstName,
    lastName,
    email,
    password,
    role,
    business,
    ipAddress,
    userAgent,
    deviceName,
}) => {

    const existingUser = await userService.findByEmail(email);

    if (existingUser) {
        throw new ApiError(409, "Email already exists");
    }

    const userData = {
        firstName,
        lastName,
        email,
        password,
        role,
    };

    // Attach business data only for BUSINESS_OWNER role
    if (role === "BUSINESS_OWNER" && business) {
        userData.business = business;
    }

    const user = await userService.create(userData);

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

    // `emailSent` reports that the verification email was durably queued for
    // delivery. Delivery itself is asynchronous and owned by the outbox
    // worker, so a transient SMTP failure never blocks or rolls back
    // account creation.
    let emailSent = false;

    try {

        // Awaited so a persistence failure is not mistaken for a queued
        // message. The dedupe key uses the token document id, which is unique
        // per token generation and contains no token material.
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

        emailSent = true;

    } catch (error) {

        // The account and token are already persisted. A queue failure is
        // logged for operators and must not surface to the client or change
        // the registration response.
        console.error(
            "Failed to queue verification email:",
            {
                userId: user._id.toString(),
                error: error?.message || error,
            }
        );

    }

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
        emailSent,
    };
};

export default register;