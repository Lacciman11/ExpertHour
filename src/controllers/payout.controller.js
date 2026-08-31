import mongoose from "mongoose";

import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import ApiError from "../utils/ApiError.js";

import payoutService from "../services/payout.service.js";

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
// Payout Controller
// ---------------------------------------------------------------------------

/**
 * Get all payouts for the authenticated consultant.
 * Consultants can only access their own payouts.
 */
export const getMyPayouts = asyncHandler(async (req, res) => {

    const { status } = req.query;

    const payouts = await payoutService.getPayoutsByConsultantId(
        req.user._id,
        status || null
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            payouts,
            "Payouts fetched successfully"
        )
    );

});

/**
 * Get a specific payout for the authenticated consultant.
 * Verifies ownership before returning.
 */
export const getMyPayoutById = asyncHandler(async (req, res) => {

    const { id } = req.params;

    validateObjectId(id);

    const payout = await payoutService.getPayoutById(id);

    if (!payout) {
        return res.status(404).json({
            success: false,
            message: "Payout not found",
        });
    }

    // Verify ownership
    if (payout.consultantId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
            success: false,
            message: "Not authorized to view this payout",
        });
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            payout,
            "Payout fetched successfully"
        )
    );

});

/**
 * Get all payouts (admin only).
 * Returns all payouts with full details.
 */
export const getAllPayouts = asyncHandler(async (req, res) => {

    const { status, page, limit } = req.query;

    const result = await payoutService.getAllPayouts({
        status,
        page,
        limit,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "All payouts fetched successfully"
        )
    );

});

/**
 * Get a specific payout by ID (admin only).
 * Returns full details.
 */
export const getPayoutById = asyncHandler(async (req, res) => {

    const { id } = req.params;

    validateObjectId(id);

    const payout = await payoutService.getPayoutById(id);

    if (!payout) {
        return res.status(404).json({
            success: false,
            message: "Payout not found",
        });
    }

    return res.status(200).json(
        new ApiResponse(
            200,
            payout,
            "Payout fetched successfully"
        )
    );

});
