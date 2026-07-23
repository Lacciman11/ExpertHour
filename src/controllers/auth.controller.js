import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import env from "../config/env.js";

import {
    authService,
    resetPasswordService,
    sessionService,
    refreshTokenService,
} from "../services/index.js";

const setAuthCookies = (res, accessToken, refreshToken) => {

    const isProduction = env.nodeEnv === "production";

    const cookieOptions = {

        httpOnly: true,

        secure: isProduction,

        sameSite: isProduction ? "strict" : "lax",

        maxAge: 15 * 60 * 1000, // 15 minutes for access token

        path: "/",

    };

    res.cookie("accessToken", accessToken, cookieOptions);

    cookieOptions.maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days for refresh token

    res.cookie("refreshToken", refreshToken, cookieOptions);

};

export const register = asyncHandler(async (req, res) => {

    const result = await authService.register({

        ...req.body,

        ipAddress: req.ip,

        userAgent: req.get("user-agent"),

        deviceName: req.get("user-agent"),

    });

    setAuthCookies(res, result.accessToken, result.refreshToken);

    const { accessToken, refreshToken, ...userResponse } = result;

    return res.status(201).json(

        new ApiResponse(

            201,

            { user: userResponse.user },

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

    setAuthCookies(res, result.accessToken, result.refreshToken);

    const { accessToken, refreshToken, ...userResponse } = result;

    return res.status(200).json(

        new ApiResponse(

            200,

            { user: userResponse.user },

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

    const refreshToken = req.cookies.refreshToken;

    await authService.logout.execute(refreshToken);

    res.clearCookie("accessToken", { path: "/" });

    res.clearCookie("refreshToken", { path: "/" });

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

export const refreshToken = asyncHandler(async (req, res) => {

    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {

        throw new ApiError(401, "Refresh token is required");

    }

    const result = await refreshTokenService.execute(refreshToken);

    setAuthCookies(res, result.accessToken, result.refreshToken);

    const { accessToken, refreshToken: newRefreshToken } = result;

    return res.status(200).json(

        new ApiResponse(

            200,

            { accessToken, refreshToken: newRefreshToken },

            "Token refreshed successfully"

        )

    );

});

export const logoutAll = asyncHandler(async (req, res) => {

    const userId = req.user._id;

    await sessionService.revokeAllSessions(userId);

    res.clearCookie("accessToken", { path: "/" });

    res.clearCookie("refreshToken", { path: "/" });

    return res.status(200).json(

        new ApiResponse(

            200,

            null,

            "Logged out from all devices successfully"

        )

    );

});
