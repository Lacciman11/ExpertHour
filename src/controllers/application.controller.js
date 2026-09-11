import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import ApiError from "../utils/ApiError.js";

import applicationService from "../services/application.service.js";

export const submitApplication = asyncHandler(async (req, res) => {

    const {
        fullName,
        email,
        phone,
        linkedinProfile,
        currentTitle,
        organisation,
        yearsExperience,
        primaryIndustry,
        primaryExpertise,
        otherExpertise,
        notableAchievement,
        businessChallenge,
        certifications,
        whyJoin,
        additionalInfo,
        consent,
    } = req.body;

    const cvFile = req.file;

    const application = await applicationService.createApplication(
        {
            fullName,
            email,
            phone,
            linkedinProfile,
            currentTitle,
            organisation,
            yearsExperience,
            primaryIndustry,
            primaryExpertise,
            otherExpertise,
            notableAchievement,
            businessChallenge,
            certifications,
            whyJoin,
            additionalInfo,
            consent,
        },
        cvFile
    );

    return res.status(201).json(
        new ApiResponse(
            201,
            {
                id: application._id,
                cvUrl: application.cv?.url || "",
            },
            "Application submitted successfully"
        )
    );

});
