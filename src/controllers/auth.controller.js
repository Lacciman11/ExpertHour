import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import env from "../config/env.js";

import {
    authService,
    resetPasswordService,
    sessionService,
} from "../services/index.js";

export const register = asyncHandler(async (req, res) => {

    const result = await authService.register({

        ...req.body,

        ipAddress: req.ip,

        userAgent: req.get("user-agent"),

        deviceName: req.get("user-agent"),

    });

    return res.status(201).json(

        new ApiResponse(
            201,
            result,
            "Registration successful"
        )

    );

});

export const login = asyncHandler(async (req, res) => {

    const result = await authService.login({
        ...req.body,
        ipAddress: req.ip,
        userAgent: req.get("user-agent"),
        deviceName: req.get("user-agent"),
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Login successful"
        )
    );
});

export const forgotPassword = asyncHandler(

    async (req, res) => {

        await authService.forgotPassword.execute(

            req.body.email

        );

        return res.status(200).json(

            new ApiResponse(

                200,

                null,

                "If an account with that email exists, a password reset link has been sent."

            )

        );

    }

);

export const resetPassword = asyncHandler(async (req, res) => {

    const {
        token,
        password
    } = req.body;

    await resetPasswordService.execute({

        token,

        password

    });

    return res.status(200).json(

        new ApiResponse(

            200,

            null,

            "Password reset successfully"

        )

    );

});

export const logout = asyncHandler(async (req, res) => {

    const { refreshToken } = req.body;

    await authService.logout.execute(refreshToken);

    return res.status(200).json(
        new ApiResponse(
            200,
            null,
            "Logged out successfully"
        )
    );

});

export const verifyEmail = asyncHandler(async (req, res) => {

    const { token } = req.query;

    await authService.verifyEmail.execute(token);

    return res.redirect(`${env.appUrl}/login?verified=true`);

});

export const resendVerificationEmail = asyncHandler(async (req, res) => {

    await authService.verifyEmail.resend(req.body.email);

    return res.status(200).json(
        new ApiResponse(
            200,
            null,
            "If an account with that email exists, a verification link has been sent."
        )
    );

});

export const logoutAll = asyncHandler(async (req, res) => {

    const userId = req.user._id;

    await sessionService.revokeAllSessions(userId);

    return res.status(200).json(
        new ApiResponse(
            200,
            null,
            "Logged out from all devices successfully"
        )
    );

});