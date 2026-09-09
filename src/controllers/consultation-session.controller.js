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

/**
 * Participant attendance signaling.
 *
 * Trust-boundary contract (see consultation-session.service.js):
 *   - The body must contain `action` ∈ {"join", "leave"} only.
 *   - Terminal statuses ("completed", "no_show_client", "no_show_consultant")
 *     and any server-derived field are rejected by the service.
 *   - This endpoint MUST NOT trigger any financial outcome.
 */
export const recordAttendanceSignal = asyncHandler(async (req, res) => {

    const { bookingId } = req.params;

    const { action } = req.body;

    const session = await ConsultationSessionService.recordAttendanceSignal(
        bookingId,
        req.user._id,
        action
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            session,
            "Attendance signal recorded"
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
