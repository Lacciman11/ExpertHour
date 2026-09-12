import axios from "axios";
import User from "../models/User.js";
import ConsultantProfile from "../models/ConsultantProfile.js";
import Booking from "../models/Booking.js";
import env from "../config/env.js";
import { APP_TIMEZONE } from "../utils/constants.js";

class GoogleCalendarService {

    getGoogleAuthUrl() {
        const { clientId, redirectUri } = env.googleCalendar;
        const scopes = [
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/meetings.space.readonly",
            "https://www.googleapis.com/auth/meetings.conferenceRecords.readonly",
            "https://www.googleapis.com/auth/meetings.participants.readonly",
            "https://www.googleapis.com/auth/meetings.attendance.readonly",
        ].join(" ");

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${clientId}&` +
            `redirect_uri=${encodeURIComponent(redirectUri)}&` +
            `response_type=code&` +
            `scope=${encodeURIComponent(scopes)}&` +
            `access_type=offline&` +
            `prompt=consent`;

        return authUrl;
    }

    async exchangeCodeForTokens(code) {
        const { clientId, clientSecret, redirectUri } = env.googleCalendar;

        if (!clientId || !clientSecret || !redirectUri) {
            throw new Error("Google Calendar API credentials are not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI environment variables.");
        }

        try {
            const response = await axios.post(
                "https://oauth2.googleapis.com/token",
                new URLSearchParams({
                    code,
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: redirectUri,
                    grant_type: "authorization_code",
                }).toString(),
                {
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                }
            );

            return {
                accessToken: response.data.access_token,
                refreshToken: response.data.refresh_token,
                expiresIn: response.data.expires_in,
            };
        } catch (error) {
            const errorMessage = error.response?.data?.error_description || error.response?.data?.error || error.message;
            throw new Error(`Failed to exchange authorization code for tokens: ${errorMessage}`);
        }
    }

    async refreshAccessToken(refreshToken) {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

        const response = await axios.post(
            "https://oauth2.googleapis.com/token",
            new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
                grant_type: "refresh_token",
            }).toString(),
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            }
        );

        return {
            accessToken: response.data.access_token,
            expiresIn: response.data.expires_in,
        };
    }

    async _getValidAccessToken(profile) {
        if (!profile.googleCalendar || !profile.googleCalendar.accessToken) {
            throw new Error("Consultant has not connected Google Calendar");
        }

        let accessToken = profile.googleCalendar.accessToken;

        // Check if token is expired using expiresAt
        if (profile.googleCalendar.expiresAt && Date.now() > profile.googleCalendar.expiresAt) {
            if (!profile.googleCalendar.refreshToken) {
                throw new Error("No refresh token available. Please reconnect Google Calendar.");
            }

            const refreshed = await this.refreshAccessToken(profile.googleCalendar.refreshToken);

            accessToken = refreshed.accessToken;

            // Update stored token with new expiry
            profile.googleCalendar.accessToken = accessToken;
            profile.googleCalendar.expiresAt = Date.now() + (refreshed.expiresIn || 3600) * 1000;
            await profile.save();
        }

        return accessToken;
    }

    async createEvent(consultantId, bookingId, date, time, duration, timezone = APP_TIMEZONE) {
        const profile = await ConsultantProfile.findOne({ userId: consultantId });

        if (!profile) {
            throw new Error("Consultant profile not found");
        }

        const accessToken = await this._getValidAccessToken(profile);

        const startTime = this._formatGoogleCalendarDateTime(date, time, timezone);
        const endTime = this._calculateEndTime(date, time, duration, timezone);

        const event = {
            summary: `ExpertHour Consultation - Booking #${bookingId}`,
            description: `Consultation session booked via ExpertHour`,
            start: {
                dateTime: startTime,
                timeZone: timezone,
            },
            end: {
                dateTime: endTime,
                timeZone: timezone,
            },
            conferenceData: {
                createRequest: {
                    requestId: bookingId,
                    conferenceSolutionKey: {
                        type: "hangoutsMeet",
                    },
                },
            },
        };

        const response = await axios.post(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            event,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                params: {
                    conferenceDataVersion: 1,
                },
            }
        );

        const meetingLink = response.data.hangoutLink;
        const googleEventId = response.data.id || "";
        const googleConferenceId = response.data.conferenceData?.conferenceId || "";

        return {
            meetingLink,
            googleEventId,
            googleConferenceId,
        };
    }

    async updateEvent(consultantId, bookingId, date, time, duration, timezone = APP_TIMEZONE) {
        const profile = await ConsultantProfile.findOne({ userId: consultantId });

        if (!profile) {
            throw new Error("Consultant profile not found");
        }

        const accessToken = await this._getValidAccessToken(profile);

        // First, find the existing event
        const searchResponse = await axios.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                params: {
                    q: `ExpertHour Consultation - Booking #${bookingId}`,
                    maxResults: 1,
                },
            }
        );

        if (!searchResponse.data.items || searchResponse.data.items.length === 0) {
            throw new Error("Google Calendar event not found for this booking");
        }

        const eventId = searchResponse.data.items[0].id;

        const startTime = this._formatGoogleCalendarDateTime(date, time, timezone);
        const endTime = this._calculateEndTime(date, time, duration, timezone);

        // Update the event
        const updatedEvent = {
            start: {
                dateTime: startTime,
                timeZone: timezone,
            },
            end: {
                dateTime: endTime,
                timeZone: timezone,
            },
        };

        const response = await axios.patch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
            updatedEvent,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
            }
        );

        const meetingLink = response.data.hangoutLink || searchResponse.data.items[0].hangoutLink;
        const googleEventId = eventId;
        const googleConferenceId = response.data.conferenceData?.conferenceId || searchResponse.data.items[0].conferenceData?.conferenceId || "";

        return {
            meetingLink,
            googleEventId,
            googleConferenceId,
        };
    }

    async createEventAndGetMeetLink(bookingId, date, time, duration, consultantId, clientId) {
        try {
            // Get timezone from client or consultant
            const [client, consultant] = await Promise.all([
                User.findById(clientId).select("timezone"),
                User.findById(consultantId).select("timezone"),
            ]);

            const timezone = client?.timezone || consultant?.timezone || APP_TIMEZONE;

            return await this.createEvent(consultantId, bookingId, date, time, duration, timezone);
        } catch (error) {
            console.error(`[GoogleCalendar] Failed to create event for booking ${bookingId}:`, error.message);
            // Return null to allow fallback to manual meeting link
            return null;
        }
    }

    async updateEventAndGetMeetLink(bookingId, date, time, duration, consultantId, clientId) {
        try {
            // Get timezone from client or consultant
            const [client, consultant] = await Promise.all([
                User.findById(clientId).select("timezone"),
                User.findById(consultantId).select("timezone"),
            ]);

            const timezone = client?.timezone || consultant?.timezone || APP_TIMEZONE;

            return await this.updateEvent(consultantId, bookingId, date, time, duration, timezone);
        } catch (error) {
            console.error(`[GoogleCalendar] Failed to update event for booking ${bookingId}:`, error.message);
            // Return null to allow fallback
            return null;
        }
    }

    async deleteEvent(consultantId, bookingId) {
        const profile = await ConsultantProfile.findOne({ userId: consultantId });

        if (!profile || !profile.googleCalendar || !profile.googleCalendar.accessToken) {
            // Consultant hasn't connected Google Calendar, nothing to delete
            return;
        }

        try {
            const accessToken = await this._getValidAccessToken(profile);

            // Find the event by searching for it
            const searchResponse = await axios.get(
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                    },
                    params: {
                        q: `ExpertHour Consultation - Booking #${bookingId}`,
                        maxResults: 1,
                    },
                }
            );

            if (searchResponse.data.items && searchResponse.data.items.length > 0) {
                const eventId = searchResponse.data.items[0].id;

                // Delete the event
                await axios.delete(
                    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                        },
                    }
                );

                console.log(`[GoogleCalendar] Deleted event for booking ${bookingId}`);
            }
        } catch (error) {
            console.error(`[GoogleCalendar] Failed to delete event for booking ${bookingId}:`, error.message);
            // Don't throw - allow cancellation to proceed even if calendar deletion fails
        }
    }

    _formatGoogleCalendarDateTime(dateStr, timeStr, timezone = APP_TIMEZONE) {
        const [hours, minutes] = timeStr.split(":").map(Number);
        const date = new Date(dateStr + "T00:00:00Z");
        date.setUTCHours(hours, minutes, 0, 0);
        return date.toISOString();
    }

    _calculateEndTime(dateStr, timeStr, duration, timezone = APP_TIMEZONE) {
        const [hours, minutes] = timeStr.split(":").map(Number);
        const date = new Date(dateStr + "T00:00:00Z");
        date.setUTCHours(hours, minutes, 0, 0);
        date.setUTCMinutes(date.getUTCMinutes() + duration);
        return date.toISOString();
    }
}

export default new GoogleCalendarService();
