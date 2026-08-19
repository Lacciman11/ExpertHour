import mongoose from "mongoose";

import ConsultationSession from "../models/ConsultationSession.js";
import Booking from "../models/Booking.js";

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

        const session = await ConsultationSession.findOne({ bookingId });

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

        return session;

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
