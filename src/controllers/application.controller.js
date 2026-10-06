import asyncHandler from "../utils/asyncHandler.js";

import { validationResult } from "express-validator";

import Application from "../models/Application.js";

import { uploadCV, uploadQualifications } from "../middlewares/upload.middleware.js";

import applicationValidation from "../validators/application.validator.js";

import applicationService from "../services/application.service.js";

import ApiError from "../utils/ApiError.js";

import ApiResponse from "../utils/ApiResponse.js";

const submitApplication = asyncHandler(async (req, res) => {

    const errors = validationResult(req);

    if (!errors.isEmpty()) {

        const errorMessages = errors.array().map((err) => err.msg);

        throw new ApiError(400, errorMessages.join(", "));

    }

    const validatedData = { ...req.body };

    if (typeof validatedData.primaryIndustry === "string") {

        try {

            validatedData.primaryIndustry = JSON.parse(validatedData.primaryIndustry);

        } catch {

            validatedData.primaryIndustry = [validatedData.primaryIndustry];

        }

    }

    if (typeof validatedData.otherExpertise === "string") {

        try {

            validatedData.otherExpertise = JSON.parse(validatedData.otherExpertise);

        } catch {

            validatedData.otherExpertise = [];

        }

    }

    const cvFiles = req.files?.cv || [];

    const qualificationFiles = req.files?.qualifications || [];

    if (!cvFiles || cvFiles.length === 0) {

        throw new ApiError(400, "CV file is required");

    }

    const result = await applicationService.createApplication(validatedData, cvFiles, qualificationFiles);

    res.status(201).json(new ApiResponse(201, result, "Application submitted successfully"));

});

const getApplications = asyncHandler(async (req, res) => {

    const { status, page = 1, limit = 10 } = req.query;

    const filter = {};

    if (status) {

        filter.status = status;

    }

    const applications = await Application.find(filter)

        .sort({ createdAt: -1 })

        .skip((page - 1) * limit)

        .limit(Number(limit));

    const total = await Application.countDocuments(filter);

    res.status(200).json(new ApiResponse(200, { applications, total, page: Number(page), limit: Number(limit) }, "Applications fetched successfully"));

});

const getApplicationById = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const application = await Application.findById(id);

    if (!application) {

        throw new ApiError(404, "Application not found");

    }

    res.status(200).json(new ApiResponse(200, application, "Application fetched successfully"));

});

const updateApplicationStatus = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const { status } = req.body;

    const application = await Application.findByIdAndUpdate(id, { status }, { new: true });

    if (!application) {

        throw new ApiError(404, "Application not found");

    }

    res.status(200).json(new ApiResponse(200, application, "Application status updated successfully"));

});

export {

    submitApplication,

    getApplications,

    getApplicationById,

    updateApplicationStatus,

};
