import asyncHandler from "../utils/asyncHandler.js";

import authService from "../services/auth/index.js";

import ApiResponse from "../utils/ApiResponse.js";

export const register = asyncHandler(async (req, res) => {

    const result = await authService.register({

        ...req.body,

        ipAddress: req.ip,

        userAgent: req.get("user-agent"),

        deviceName: req.get("user-agent"),

    });

    return res.status(201).json(

        new ApiResponse(
            201,
            result,
            "Registration successful"
        )

    );

});