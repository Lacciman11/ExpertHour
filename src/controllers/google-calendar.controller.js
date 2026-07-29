import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import ApiError from "../utils/ApiError.js";

import googleCalendarService from "../services/google-calendar.service.js";
import ConsultantProfile from "../models/ConsultantProfile.js";

export const getGoogleAuthUrl = asyncHandler(async (req, res) => {
    const authUrl = googleCalendarService.getGoogleAuthUrl();

    return res.status(200).json(
        new ApiResponse(
            200,
            { authUrl },
            "Google Calendar auth URL generated"
        )
    );
});

export const handleGoogleCallback = asyncHandler(async (req, res) => {
    const { code } = req.body;
    const userId = req.user._id;

    if (!code) {
        throw new ApiError(400, "Authorization code is required");
    }

    const tokens = await googleCalendarService.exchangeCodeForTokens(code);

    const profile = await ConsultantProfile.findOne({ userId });

    if (!profile) {
        throw new ApiError(404, "Consultant profile not found");
    }

    profile.googleCalendar = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(Date.now() + (tokens.expiresIn || 3600) * 1000),
        connected: true,
    };

    await profile.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            { connected: true },
            "Google Calendar connected successfully"
        )
    );
});

export const disconnectGoogleCalendar = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const profile = await ConsultantProfile.findOne({ userId });

    if (!profile) {
        throw new ApiError(404, "Consultant profile not found");
    }

    profile.googleCalendar = {
        accessToken: null,
        refreshToken: null,
        expiresAt: null,
        connected: false,
    };

    await profile.save();

    return res.status(200).json(
        new ApiResponse(
            200,
            { connected: false },
            "Google Calendar disconnected successfully"
        )
    );
});
