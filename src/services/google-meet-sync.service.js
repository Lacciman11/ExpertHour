/**
 * Google Meet Attendance Synchronization Orchestration Service
 *
 * Coordinates the existing Google Meet services to synchronize verified
 * attendance data into ConsultationSession.
 *
 * This service does NOT:
 *   - calculate attendance thresholds
 *   - calculate session outcomes
 *   - modify attendanceStatus, startedAt, endedAt, clientJoinedAt,
 *     consultantJoinedAt, attendance durations, or met flags
 *   - create earnings, trigger financial processing, or create refunds
 *   - create workers
 *
 * It ONLY coordinates the existing services.
 */

import Booking from "../models/Booking.js";
import ConsultantProfile from "../models/ConsultantProfile.js";
import ApiError from "../utils/ApiError.js";
import GoogleCalendarService from "../services/google-calendar.service.js";
import GoogleMeetService from "../services/google-meet.service.js";
import { buildVerifiedAttendanceEvents } from "../services/google-meet-attendance.service.js";
import consultationSessionService, { calculateScheduledWindow } from "../services/consultation-session.service.js";

class GoogleMeetSyncService {

    /**
     * Synchronize verified Google Meet attendance for one booking.
     *
     * Flow:
     *   1. Load Booking by bookingId.
     *   2. Validate booking exists and has googleConferenceId.
     *   3. Load consultant profile and obtain valid Google access token.
     *   4. Calculate scheduled window from booking.
     *   5. Find matching conference record via findConferenceRecordForBooking().
     *   6. If no conference record, return { synced: false, reason: "CONFERENCE_RECORD_NOT_FOUND" }.
     *   7. Retrieve attendance via getConferenceAttendance().
     *   8. Convert to attendanceEvents via buildVerifiedAttendanceEvents().
     *   9. Persist via consultationSessionService.syncGoogleAttendance().
     *
     * @param {Object} params
     * @param {string} params.bookingId - Booking ID
     * @returns {Promise<Object>} Sync result
     */
    async syncBookingAttendance({ bookingId }) {
        // 1. Load the Booking
        const booking = await Booking.findById(bookingId);
        if (!booking) {
            throw new ApiError(404, "Booking not found");
        }

        // 2. Validate googleConferenceId (Meet Space ID)
        if (!booking.googleConferenceId || typeof booking.googleConferenceId !== "string" || booking.googleConferenceId.trim() === "") {
            throw new ApiError(400, "Booking is missing googleConferenceId");
        }

        const spaceId = booking.googleConferenceId;

        // 3. Load consultant profile
        const profile = await ConsultantProfile.findOne({ userId: booking.consultantId });
        if (!profile) {
            throw new ApiError(404, "Consultant profile not found");
        }

        // 4. Obtain valid Google access token
        let accessToken;
        try {
            accessToken = await GoogleCalendarService._getValidAccessToken(profile);
        } catch (error) {
            const message = error.message || "";
            if (message.includes("not connected") || message.includes("not connected Google Calendar")) {
                throw new ApiError(400, "Google Calendar connection missing");
            }
            if (message.includes("No refresh token")) {
                throw new ApiError(400, "Google access token unavailable");
            }
            throw new ApiError(502, `Google access token error: ${message}`);
        }

        // 5. Require consultant googleEmail
        const consultantGoogleEmail = profile.googleEmail;
        if (!consultantGoogleEmail || typeof consultantGoogleEmail !== "string" || consultantGoogleEmail.trim() === "") {
            throw new ApiError(400, "Missing consultant googleEmail");
        }

        // 6. Calculate scheduled window for conference record matching
        const win = calculateScheduledWindow(booking);
        const scheduledStart = win.scheduledStart.toISOString();
        const scheduledEnd = win.scheduledEnd.toISOString();

        // 7. Find matching conference record
        let conferenceRecord;
        try {
            conferenceRecord = await GoogleMeetService.findConferenceRecordForBooking(
                accessToken,
                spaceId,
                scheduledStart,
                scheduledEnd
            );
        } catch (error) {
            throw new ApiError(502, `Google API failure: ${error.message}`);
        }

        if (!conferenceRecord) {
            return {
                synced: false,
                reason: "CONFERENCE_RECORD_NOT_FOUND",
            };
        }

        const conferenceRecordId = conferenceRecord.name;

        // 8. Retrieve attendance
        let attendance;
        try {
            attendance = await GoogleMeetService.getConferenceAttendance(
                accessToken,
                spaceId,
                conferenceRecordId,
                consultantGoogleEmail
            );
        } catch (error) {
            throw new ApiError(502, `Google API failure: ${error.message}`);
        }

        // 9. Convert to attendanceEvents
        const consultantSessions = attendance.consultant?.sessions || [];
        const clientSessions = attendance.client?.sessions || [];

        const normalizedEvents = buildVerifiedAttendanceEvents({
            consultantSessions,
            clientSessions,
        });

        const attendanceEvents = [...normalizedEvents.consultant, ...normalizedEvents.client];

        // 10. Persist
        let session;
        try {
            session = await consultationSessionService.syncGoogleAttendance({
                bookingId: booking._id.toString(),
                conferenceRecordId,
                attendanceEvents,
            });
        } catch (error) {
            throw new ApiError(500, `Failed to persist attendance: ${error.message}`);
        }

        return {
            synced: true,
            conferenceRecordId,
            attendanceEvents,
            session,
        };
    }
}

export default new GoogleMeetSyncService();
