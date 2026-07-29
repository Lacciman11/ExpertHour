import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import availabilityService from "../services/availability.service.js";
import ConsultantProfile from "../models/ConsultantProfile.js";

export const getMyAvailability = asyncHandler(async (req, res) => {

    const profile = await ConsultantProfile.findOne({ userId: req.user._id });

    if (!profile) {
        return res.status(404).json({
            success: false,
            message: "Consultant profile not found",
        });
    }

    const slots = await availabilityService.findByConsultantProfileId(profile._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            slots,
            "Availability fetched successfully"
        )
    );

});

export const setAvailability = asyncHandler(async (req, res) => {

    const profile = await ConsultantProfile.findOne({ userId: req.user._id });

    if (!profile) {
        return res.status(404).json({
            success: false,
            message: "Consultant profile not found",
        });
    }

    const slots = await availabilityService.setAvailability(profile._id, req.body);

    return res.status(200).json(
        new ApiResponse(
            200,
            slots,
            "Availability updated successfully"
        )
    );

});

export const getConsultantAvailability = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const slots = await availabilityService.findByConsultantProfileId(id);

    return res.status(200).json(
        new ApiResponse(
            200,
            slots,
            "Consultant availability fetched successfully"
        )
    );

});

export const deleteAvailabilitySlot = asyncHandler(async (req, res) => {

    const { id } = req.params;

    await availabilityService.deleteSlot(id, req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            null,
            "Availability slot deleted successfully"
        )
    );

});

export const getAvailableSlots = asyncHandler(async (req, res) => {

    const { id } = req.params;
    const { date } = req.query;

    if (!date) {
        return res.status(400).json({
            success: false,
            message: "Date query parameter is required",
        });
    }

    const slots = await availabilityService.getAvailableSlots(id, date);

    return res.status(200).json(
        new ApiResponse(
            200,
            slots,
            "Available slots fetched successfully"
        )
    );

});
