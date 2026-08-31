import mongoose from "mongoose";

import ConsultationSession from "../models/ConsultationSession.js";
import Booking from "../models/Booking.js";
import consultantEarningService from "./consultant-earning.service.js";
import { SESSION_OUTCOME } from "../utils/constants.js";

class ConsultationSessionService {

    async createOrUpdateSession(bookingId, userId, data) {

        const booking = await Booking.findById(bookingId);

        if (!booking) {

            throw new Error("Booking not found");

        }

        // Only consultant or client can update session
        const isConsultant = booking.consultantId.toString() === userId.toString();
        const isClient = booking.clientId.toString() === userId.toString();

        if (!isConsultant && !isClient) {

            throw new Error("Not authorized to update this session");

        }

        let session = await ConsultationSession.findOne({ bookingId });

        if (!session) {

            session = await ConsultationSession.create({

                bookingId,

                consultantId: booking.consultantId,

                clientId: booking.clientId,

                ...data,

            });

        } else {

            session = await ConsultationSession.findByIdAndUpdate(

                session._id,

                { $set: data },

                { new: true, runValidators: true }

            );

        }

        return session;

    }

    async getSessionByBookingId(bookingId, userId) {

        const booking = await Booking.findById(bookingId);

        if (!booking) {

            throw new Error("Booking not found");

        }

        const isConsultant = booking.consultantId.toString() === userId.toString();
        const isClient = booking.clientId.toString() === userId.toString();

        if (!isConsultant && !isClient) {

            throw new Error("Not authorized to view this session");

        }

        const session = await ConsultationSession.findOne({ bookingId });

        return session;

    }

    async updateAttendance(bookingId, userId, attendanceStatus) {

        const booking = await Booking.findById(bookingId);

        if (!booking) {

            throw new Error("Booking not found");

        }

        const isConsultant = booking.consultantId.toString() === userId.toString();
        const isClient = booking.clientId.toString() === userId.toString();

        if (!isConsultant && !isClient) {

            throw new Error("Not authorized to update attendance");

        }

        let session = await ConsultationSession.findOne({ bookingId });

        if (!session) {

            throw new Error("Session not found");

        }

        const updateData = { attendanceStatus };

        if (attendanceStatus === "in_progress") {

            updateData.startedAt = new Date();

            if (isClient) {

                updateData.clientJoinedAt = new Date();

            }

            if (isConsultant) {

                updateData.consultantJoinedAt = new Date();

            }

        } else if (attendanceStatus === "completed") {

            updateData.endedAt = new Date();

        }

        session = await ConsultationSession.findByIdAndUpdate(

            session._id,

            { $set: updateData },

            { new: true, runValidators: true }

        );

        // If session reached a terminal attendance state, create the earning
        const terminalStatuses = [
            "completed",
            "no_show_client",
            "no_show_consultant",
        ];

        if (terminalStatuses.includes(attendanceStatus)) {
            const sessionOutcome = this._determineSessionOutcome(session, attendanceStatus);
            await consultantEarningService.createEarningFromSession(bookingId, sessionOutcome);
        }

        return session;

    }

    /**
     * Determine the session outcome from attendance data.
     * @param {object} session - ConsultationSession document
     * @param {string} attendanceStatus - The terminal attendance status
     * @returns {string} SESSION_OUTCOME value
     */
    _determineSessionOutcome(session, attendanceStatus) {
        if (attendanceStatus === "no_show_client") {
            return SESSION_OUTCOME.CUSTOMER_NO_SHOW;
        }

        if (attendanceStatus === "no_show_consultant") {
            return SESSION_OUTCOME.CONSULTANT_NO_SHOW;
        }

        // For completed sessions, use attendance met flags when available
        const clientMet = session.clientAttendanceMet;
        const consultantMet = session.consultantAttendanceMet;

        if (clientMet && consultantMet) {
            return SESSION_OUTCOME.COMPLETED;
        }

        if (consultantMet && !clientMet) {
            return SESSION_OUTCOME.CUSTOMER_INSUFFICIENT;
        }

        if (clientMet && !consultantMet) {
            return SESSION_OUTCOME.CONSULTANT_INSUFFICIENT;
        }

        // Both false or undetermined
        return SESSION_OUTCOME.NEITHER_MET;

    }

    async addRecordingUrl(bookingId, userId, recordingUrl) {

        const booking = await Booking.findById(bookingId);

        if (!booking) {

            throw new Error("Booking not found");

        }

        if (booking.consultantId.toString() !== userId.toString()) {

            throw new Error("Only consultant can add recording URL");

        }

        const session = await ConsultationSession.findOne({ bookingId });

        if (!session) {

            throw new Error("Session not found");

        }

        session.recordingUrl = recordingUrl;

        await session.save();

        return session;

    }

}

export default new ConsultationSessionService();
