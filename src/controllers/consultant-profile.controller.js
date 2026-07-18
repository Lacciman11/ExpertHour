import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import consultantProfileService from "../services/consultant-profile.service.js";

export const createConsultantProfile = asyncHandler(async (req, res) => {

    const profile = await consultantProfileService.create(req.user._id, req.body);

    return res.status(201).json(
        new ApiResponse(
            201,
            profile,
            "Consultant profile created successfully"
        )
    );

});

export const getMyConsultantProfile = asyncHandler(async (req, res) => {

    const profile = await consultantProfileService.findByUserId(req.user._id);

    if (!profile) {

        return res.status(404).json({

            success: false,

            message: "Consultant profile not found",

        });

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            profile,
            "Consultant profile fetched successfully"
        )
    );

});

export const getConsultantProfileById = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const profile = await consultantProfileService.findById(id);

    if (!profile || !profile.isActive) {

        return res.status(404).json({

            success: false,

            message: "Consultant profile not found",

        });

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            profile,
            "Consultant profile fetched successfully"
        )
    );

});

export const updateConsultantProfile = asyncHandler(async (req, res) => {

    const profile = await consultantProfileService.update(req.user._id, req.body);

    return res.status(200).json(
        new ApiResponse(
            200,
            profile,
            "Consultant profile updated successfully"
        )
    );

});

export const searchConsultants = asyncHandler(async (req, res) => {

    const filters = {

        skills: req.query.skills ? req.query.skills.split(",") : [],

        minRate: req.query.minRate ? parseFloat(req.query.minRate) : undefined,

        maxRate: req.query.maxRate ? parseFloat(req.query.maxRate) : undefined,

        availability: req.query.availability,

        location: req.query.location,

    };

    const pagination = {

        page: parseInt(req.query.page) || 1,

        limit: parseInt(req.query.limit) || 10,

    };

    const result = await consultantProfileService.findAll(filters, pagination);

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Consultants fetched successfully"
        )
    );

});

export const deleteConsultantProfile = asyncHandler(async (req, res) => {

    const profile = await consultantProfileService.delete(req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            null,
            "Consultant profile deleted successfully"
        )
    );

});
