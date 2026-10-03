import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import ApiError from "../utils/ApiError.js";

import axios from "axios";

import googleCalendarService from "../services/google-calendar.service.js";
import tokenService from "../services/token.service.js";
import ConsultantProfile from "../models/ConsultantProfile.js";
import env from "../config/env.js";

export const getGoogleAuthUrl = asyncHandler(async (req, res) => {
    const authUrl = googleCalendarService.getGoogleAuthUrl(req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            { authUrl },
            "Google Calendar auth URL generated"
        )
    );
});

export const handleGoogleCallback = asyncHandler(async (req, res) => {
    // Support both GET (Google OAuth redirect) and POST (frontend-mediated) callbacks.
    // The GET flow is the secure path: Google sends the authorization code directly
    // to the backend, which exchanges it server-side and never exposes the code to
    // frontend JavaScript.
    const code = req.method === "GET" ? req.query.code : req.body?.code;

    if (!code) {
        if (req.method === "GET") {
            return res.redirect(`${env.frontendUrl}/google-calendar/callback?status=error`);
        }
        throw new ApiError(400, "Authorization code is required");
    }

    let userId;

    if (req.method === "GET") {
        const state = req.query.state;

        if (!state) {
            return res.redirect(`${env.frontendUrl}/google-calendar/callback?status=error`);
        }

        let decodedState;
        try {
            decodedState = tokenService.verifyAccessToken(state);
        } catch (error) {
            return res.redirect(`${env.frontendUrl}/google-calendar/callback?status=error`);
        }

        if (decodedState.type !== "google_oauth_state" || !decodedState.userId) {
            return res.redirect(`${env.frontendUrl}/google-calendar/callback?status=error`);
        }

        userId = decodedState.userId;
    } else {
        userId = req.user._id;
    }

    try {
        const tokens = await googleCalendarService.exchangeCodeForTokens(code);

        const profile = await ConsultantProfile.findOne({ userId });

        if (!profile) {
            if (req.method === "GET") {
                return res.redirect(`${env.frontendUrl}/google-calendar/callback?status=error`);
            }
            throw new ApiError(404, "Consultant profile not found");
        }

        // Fetch the authenticated Google account's email using the userinfo endpoint
        let googleEmail = "";
        try {
            const userInfoResponse = await axios.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                {
                    headers: {
                        Authorization: `Bearer ${tokens.accessToken}`,
                    },
                }
            );
            googleEmail = userInfoResponse.data.email || "";
        } catch (error) {
            // If userinfo fetch fails, continue without email
            // The consultant can re-authorize later to capture the email
            console.error("[GoogleCalendar] Failed to fetch user info:", error.message);
        }

        profile.googleCalendar = {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: new Date(Date.now() + (tokens.expiresIn || 3600) * 1000),
            connected: true,
        };

        profile.googleEmail = googleEmail;

        await profile.save();

        if (req.method === "GET") {
            return res.redirect(`${env.frontendUrl}/google-calendar/callback?status=success`);
        }

        return res.status(200).json(
            new ApiResponse(
                200,
                { connected: true },
                "Google Calendar connected successfully"
            )
        );
    } catch (error) {
        if (req.method === "GET") {
            return res.redirect(`${env.frontendUrl}/google-calendar/callback?status=error`);
        }
        throw error;
    }
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
