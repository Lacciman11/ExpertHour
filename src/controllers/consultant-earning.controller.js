import mongoose from "mongoose";

import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import ApiError from "../utils/ApiError.js";

import consultantEarningService from "../services/consultant-earning.service.js";

import { USER_ROLES } from "../utils/constants.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate MongoDB ObjectId format.
 * @param {string} id - The ID to validate
 * @throws {ApiError} If ID is invalid
 */
function validateObjectId(id) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, "Invalid ID format");
    }
}

// ---------------------------------------------------------------------------
// Consultant Earning Controller
// ---------------------------------------------------------------------------

/**
 * Get all earnings for the authenticated consultant.
 * Consultants can only access their own earnings.
 * Response is filtered by role (privacy).
 */
export const getMyEarnings = asyncHandler(async (req, res) => {

    const { status } = req.query;

    const earnings = await consultantEarningService.getEarningsByConsultantId(
        req.user._id,
        status || null,
        USER_ROLES.CONSULTANT
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            earnings,
            "Earnings fetched successfully"
        )
    );

});

/**
 * Get a specific earning for the authenticated consultant.
 * Verifies ownership before returning.
 * Response is filtered by role (privacy).
 */
export const getMyEarningById = asyncHandler(async (req, res) => {

    const { id } = req.params;

    validateObjectId(id);

    const earning = await consultantEarningService.getEarningById(id);

    if (!earning) {
        return res.status(404).json({
            success: false,
            message: "Earning not found",
        });
    }

    // Verify ownership
    if (earning.consultantId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
            success: false,
            message: "Not authorized to view this earning",
        });
    }

    const serialized = consultantEarningService.serializeForRole(earning, USER_ROLES.CONSULTANT);

    return res.status(200).json(
        new ApiResponse(
            200,
            serialized,
            "Earning fetched successfully"
        )
    );

});

/**
 * Get all earnings (admin only).
 * Returns all earnings with full financial details.
 */
export const getAllEarnings = asyncHandler(async (req, res) => {

    const { status, page, limit } = req.query;

    const result = await consultantEarningService.getAllEarnings({
        status,
        page,
        limit,
        userRole: USER_ROLES.ADMIN,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "All earnings fetched successfully"
        )
    );

});

/**
 * Get a specific earning by ID (admin only).
 * Returns full financial details.
 */
export const getEarningById = asyncHandler(async (req, res) => {

    const { id } = req.params;

    validateObjectId(id);

    const earning = await consultantEarningService.getEarningById(id);

    if (!earning) {
        return res.status(404).json({
            success: false,
            message: "Earning not found",
        });
    }

    const serialized = consultantEarningService.serializeForRole(earning, USER_ROLES.ADMIN);

    return res.status(200).json(
        new ApiResponse(
            200,
            serialized,
            "Earning fetched successfully"
        )
    );

});
