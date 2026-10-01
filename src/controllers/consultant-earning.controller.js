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

    const { status, from, to, page, limit } = req.query;

    // Validate date parameters if provided
    if (from) {
        consultantEarningService._validateLagosDate(from, "from");
    }
    if (to) {
        consultantEarningService._validateLagosDate(to, "to");
    }

    // Validate from > to
    if (from && to) {
        const fromUTC = consultantEarningService._lagosDateToUTC(from);
        const [year, month, day] = to.split("-").map(Number);
        const nextDay = new Date(Date.UTC(year, month - 1, day));
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const nextDayStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
        const toExclusive = consultantEarningService._lagosDateToUTC(nextDayStr);

        if (fromUTC >= toExclusive) {
            return res.status(400).json({
                success: false,
                message: "Invalid date range: from date must be before to date.",
            });
        }
    }

    // Validate pagination parameters
    const pageNum = page !== undefined ? parseInt(page, 10) : 1;
    const limitNum = limit !== undefined ? parseInt(limit, 10) : 10;

    if (isNaN(pageNum) || pageNum < 1) {
        return res.status(400).json({
            success: false,
            message: "Invalid page: must be a positive integer.",
        });
    }

    if (isNaN(limitNum) || limitNum < 1) {
        return res.status(400).json({
            success: false,
            message: "Invalid limit: must be a positive integer.",
        });
    }

    if (limitNum > 50) {
        return res.status(400).json({
            success: false,
            message: "Invalid limit: maximum allowed is 50.",
        });
    }

    const result = await consultantEarningService.getEarningsByConsultantId(
        req.user._id,
        status || null,
        from || null,
        to || null,
        pageNum,
        limitNum,
        USER_ROLES.CONSULTANT
    );

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Earnings fetched successfully"
        )
    );

});

/**
 * Export all earnings for the authenticated consultant as CSV.
 * Consultants can only export their own earnings.
 * Response is filtered by role (privacy).
 */
export const exportMyEarnings = asyncHandler(async (req, res) => {
    const { status, from, to } = req.query;

    // Validate date parameters if provided
    if (from) {
        consultantEarningService._validateLagosDate(from, "from");
    }
    if (to) {
        consultantEarningService._validateLagosDate(to, "to");
    }

    // Validate from > to
    if (from && to) {
        const fromUTC = consultantEarningService._lagosDateToUTC(from);
        const [year, month, day] = to.split("-").map(Number);
        const nextDay = new Date(Date.UTC(year, month - 1, day));
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const nextDayStr = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
        const toExclusive = consultantEarningService._lagosDateToUTC(nextDayStr);

        if (fromUTC >= toExclusive) {
            return res.status(400).json({
                success: false,
                message: "Invalid date range: from date must be before to date.",
            });
        }
    }

    const csv = await consultantEarningService.exportEarningsByConsultantId(
        req.user._id,
        {
            status: status || null,
            from: from || null,
            to: to || null,
        }
    );

    const today = new Date();
    const filename = `earnings-export-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
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
