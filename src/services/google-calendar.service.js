import axios from "axios";
import ConsultantProfile from "../models/ConsultantProfile.js";

class GoogleCalendarService {

    getGoogleAuthUrl() {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const redirectUri = process.env.GOOGLE_REDIRECT_URI;
        const scopes = [
            "https://www.googleapis.com/auth/calendar.events",
        ].join(" ");

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${clientId}&` +
            `redirect_uri=${redirectUri}&` +
            `response_type=code&` +
            `scope=${encodeURIComponent(scopes)}&` +
            `access_type=offline&` +
            `prompt=consent`;

        return authUrl;
    }

    async exchangeCodeForTokens(code) {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const redirectUri = process.env.GOOGLE_REDIRECT_URI;

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

        return response.data.access_token;
    }

    async createEvent(consultantId, bookingId, date, time, duration) {
        const profile = await ConsultantProfile.findOne({ userId: consultantId });

        if (!profile || !profile.googleCalendar || !profile.googleCalendar.accessToken) {
            throw new Error("Consultant has not connected Google Calendar");
        }

        let accessToken = profile.googleCalendar.accessToken;

        // Check if token is expired
        if (profile.googleCalendar.expiresAt && Date.now() > profile.googleCalendar.expiresAt) {
            accessToken = await this.refreshAccessToken(profile.googleCalendar.refreshToken);

            // Update stored token
            profile.googleCalendar.accessToken = accessToken;
            profile.googleCalendar.expiresAt = Date.now() + (profile.googleCalendar.expiresIn || 3600) * 1000;
            await profile.save();
        }

        const startTime = this._formatGoogleCalendarDateTime(date, time);
        const endTime = this._calculateEndTime(date, time, duration);

        const event = {
            summary: `ExpertHour Consultation - Booking #${bookingId}`,
            description: `Consultation session booked via ExpertHour`,
            start: {
                dateTime: startTime,
                timeZone: "UTC",
            },
            end: {
                dateTime: endTime,
                timeZone: "UTC",
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

        return meetingLink;
    }

    async createEventAndGetMeetLink(bookingId, date, time, duration, consultantId, clientId) {
        return await this.createEvent(consultantId, bookingId, date, time, duration);
    }

    _formatGoogleCalendarDateTime(dateStr, timeStr) {
        const [hours, minutes] = timeStr.split(":").map(Number);
        const date = new Date(dateStr + "T00:00:00Z");
        date.setUTCHours(hours, minutes, 0, 0);
        return date.toISOString();
    }

    _calculateEndTime(dateStr, timeStr, duration) {
        const [hours, minutes] = timeStr.split(":").map(Number);
        const date = new Date(dateStr + "T00:00:00Z");
        date.setUTCHours(hours, minutes, 0, 0);
        date.setUTCMinutes(date.getUTCMinutes() + duration);
        return date.toISOString();
    }
}

export default new GoogleCalendarService();
