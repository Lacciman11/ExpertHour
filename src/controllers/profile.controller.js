import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import userService from "../services/user.service.js";
import cloudinaryService from "../services/cloudinary.service.js";
import sessionService from "../services/session.service.js";

export const getProfile = asyncHandler(async (req, res) => {

    const user = await userService.getCurrentUser(req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            user,
            "Profile fetched successfully"
        )
    );

});

export const updateProfile = asyncHandler(async (req, res) => {

    const allowedFields = ["firstName", "lastName"];

    const updates = {};

    for (const key of allowedFields) {

        if (req.body[key] !== undefined) {

            updates[key] = req.body[key];

        }

    }

    const user = await userService.updateProfile(req.user._id, updates);

    return res.status(200).json(
        new ApiResponse(
            200,
            user,
            "Profile updated successfully"
        )
    );

});

export const changePassword = asyncHandler(async (req, res) => {

    const { currentPassword, newPassword } = req.body;

    await userService.changePassword(req.user._id, currentPassword, newPassword);

    return res.status(200).json(
        new ApiResponse(
            200,
            null,
            "Password changed successfully"
        )
    );

});

export const uploadAvatar = asyncHandler(async (req, res) => {

    if (!req.file) {

        return res.status(400).json({

            success: false,

            message: "Please upload an image file",

        });

    }

    const existingAvatar = req.user.avatar?.publicId;

    if (existingAvatar) {

        await cloudinaryService.deleteAvatar(existingAvatar);

    }

    const avatar = await cloudinaryService.uploadAvatar(req.file);

    const user = await userService.uploadAvatar(req.user._id, avatar);

    return res.status(200).json(
        new ApiResponse(
            200,
            { avatar: user.avatar },
            "Avatar uploaded successfully"
        )
    );

});

export const deleteAvatar = asyncHandler(async (req, res) => {

    const { publicId } = await userService.deleteAvatar(req.user._id);

    if (publicId) {

        await cloudinaryService.deleteAvatar(publicId);

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            null,
            "Avatar deleted successfully"
        )
    );

});

export const deleteAccount = asyncHandler(async (req, res) => {

    await userService.deleteAccount(req.user._id);

    await sessionService.revokeAllSessions(req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            null,
            "Account deleted successfully"
        )
    );

});
