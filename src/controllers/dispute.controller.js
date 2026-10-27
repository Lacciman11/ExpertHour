import asyncHandler from "../utils/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";
import disputeService from "../services/dispute.service.js";

export const openDispute = asyncHandler(async (req, res) => {
    const { bookingId, reason } = req.body;
    const dispute = await disputeService.openDispute(bookingId, reason, req.user);
    return res.status(201).json(new ApiResponse(201, dispute, "Dispute opened successfully"));
});

export const resolveDispute = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { resolution, resolutionNotes, resolutionAmount } = req.body;
    const dispute = await disputeService.resolveDispute(id, { resolution, resolutionNotes, resolutionAmount }, req.user);
    return res.status(200).json(new ApiResponse(200, dispute, "Dispute resolved successfully"));
});