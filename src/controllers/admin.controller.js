import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import adminService from "../services/admin.service.js";

export const getDashboardStats = asyncHandler(async (req, res) => {

    const stats = await adminService.getDashboardStats();

    return res.status(200).json(
        new ApiResponse(
            200,
            stats,
            "Dashboard stats fetched successfully"
        )
    );

});

export const getPaymentStats = asyncHandler(async (req, res) => {

    const stats = await adminService.getPaymentStats();

    return res.status(200).json(
        new ApiResponse(
            200,
            stats,
            "Payment stats fetched successfully"
        )
    );

});

export const getAllPayments = asyncHandler(async (req, res) => {

    const { paymentStatus, refundStatus, search, page, limit, startDate, endDate } = req.query;

    const result = await adminService.getAllPayments({
        paymentStatus,
        refundStatus,
        search,
        page,
        limit,
        startDate,
        endDate,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Payments fetched successfully"
        )
    );

});

export const getAllUsers = asyncHandler(async (req, res) => {

    const { search, status, role, page, limit } = req.query;

    const result = await adminService.getAllUsers({
        search,
        status,
        role,
        page,
        limit,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Users fetched successfully"
        )
    );

});

export const getAllConsultants = asyncHandler(async (req, res) => {

    const { search, status, page, limit } = req.query;

    const result = await adminService.getAllConsultants({
        search,
        status,
        page,
        limit,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Consultants fetched successfully"
        )
    );

});

export const getPendingConsultants = asyncHandler(async (req, res) => {

    const profiles = await adminService.getPendingConsultants();

    return res.status(200).json(
        new ApiResponse(
            200,
            profiles,
            "Pending consultants fetched successfully"
        )
    );

});

export const getAllBookings = asyncHandler(async (req, res) => {

    const { status, page, limit, consultantId, clientId } = req.query;

    const result = await adminService.getAllBookings({
        status,
        page,
        limit,
        consultantId,
        clientId,
    });

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "All bookings fetched successfully"
        )
    );

});

export const getReportsData = asyncHandler(async (req, res) => {

    const data = await adminService.getReportsData();

    return res.status(200).json(
        new ApiResponse(
            200,
            data,
            "Reports data fetched successfully"
        )
    );

});

export const getTopPerformers = asyncHandler(async (req, res) => {

    const topPerformers = await adminService.getTopPerformers();

    return res.status(200).json(
        new ApiResponse(
            200,
            topPerformers,
            "Top performers fetched successfully"
        )
    );

});

export const banUser = asyncHandler(async (req, res) => {

    const { userId } = req.params;

    const user = await adminService.banUser(userId);

    if (!user) {

        return res.status(404).json({
            success: false,
            message: "User not found",
        });

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            user,
            "User banned successfully"
        )
    );

});

export const unbanUser = asyncHandler(async (req, res) => {

    const { userId } = req.params;

    const user = await adminService.unbanUser(userId);

    if (!user) {

        return res.status(404).json({
            success: false,
            message: "User not found",
        });

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            user,
            "User unbanned successfully"
        )
    );

});

export const approveConsultant = asyncHandler(async (req, res) => {

    const { profileId } = req.params;

    const profile = await adminService.approveConsultant(profileId);

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
            "Consultant approved successfully"
        )
    );

});

export const rejectConsultant = asyncHandler(async (req, res) => {

    const { profileId } = req.params;

    const profile = await adminService.rejectConsultant(profileId);

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
            "Consultant rejected successfully"
        )
    );

});

export const suspendConsultant = asyncHandler(async (req, res) => {

    const { profileId } = req.params;

    const profile = await adminService.suspendConsultant(profileId);

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
            "Consultant suspended successfully"
        )
    );

});

export const activateConsultant = asyncHandler(async (req, res) => {

    const { profileId } = req.params;

    const profile = await adminService.activateConsultant(profileId);

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
            "Consultant activated successfully"
        )
    );

});

export const changeUserRole = asyncHandler(async (req, res) => {

    const { userId } = req.params;
    const { role } = req.body;

    const user = await adminService.changeUserRole(userId, role);

    if (!user) {

        return res.status(404).json({
            success: false,
            message: "User not found",
        });

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            user,
            "User role updated successfully"
        )
    );

});
