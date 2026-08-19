import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import ApiError from "../utils/ApiError.js";

import ConsultationSessionService from "../services/consultation-session.service.js";

export const createOrUpdateSession = asyncHandler(async (req, res) => {

    const { bookingId } = req.params;

    const { notes, recordingUrl } = req.body;

    const session = await ConsultationSessionService.createOrUpdateSession(bookingId, req.user._id, {

        notes: notes || "",

        recordingUrl: recordingUrl || "",

    });

    return res.status(200).json(
        new ApiResponse(
            200,
            session,
            "Session updated successfully"
        )
    );

});

export const getSessionByBookingId = asyncHandler(async (req, res) => {

    const { bookingId } = req.params;

    const session = await ConsultationSessionService.getSessionByBookingId(bookingId, req.user._id);

    if (!session) {

        return res.status(200).json(
            new ApiResponse(
                200,
                null,
                "No session found for this booking"
            )
        );

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            session,
            "Session fetched successfully"
        )
    );

});

export const updateAttendance = asyncHandler(async (req, res) => {

    const { bookingId } = req.params;

    const { attendanceStatus } = req.body;

    const session = await ConsultationSessionService.updateAttendance(bookingId, req.user._id, attendanceStatus);

    return res.status(200).json(
        new ApiResponse(
            200,
            session,
            "Attendance updated successfully"
        )
    );

});

export const addRecordingUrl = asyncHandler(async (req, res) => {

    const { bookingId } = req.params;

    const { recordingUrl } = req.body;

    const session = await ConsultationSessionService.addRecordingUrl(bookingId, req.user._id, recordingUrl);

    return res.status(200).json(
        new ApiResponse(
            200,
            session,
            "Recording URL added successfully"
        )
    );

});
