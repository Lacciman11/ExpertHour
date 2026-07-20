import env from "../../config/env.js";

import ApiError from "../../utils/ApiError.js";

import tokenService from "../token.service.js";
import sessionService from "../session.service.js";
import userService from "../user.service.js";

class RefreshTokenService {

    async execute(refreshToken) {

        if (!refreshToken) {

            throw new ApiError(401, "Refresh token is required");

        }

        const decoded = tokenService.verifyRefreshToken(refreshToken);

        const session = await sessionService.findSession(refreshToken);

        if (!session) {

            throw new ApiError(401, "Invalid refresh token");

        }

        if (session.expiresAt < new Date()) {

            throw new ApiError(401, "Refresh token expired");

        }

        const user = await userService.findById(decoded.userId);

        if (!user || !user.isActive) {

            throw new ApiError(401, "User not found or inactive");

        }

        const payload = {
            userId: user._id,
            role: user.role,
        };

        const newAccessToken =
            tokenService.generateAccessToken(payload);

        const newRefreshToken =
            tokenService.generateRefreshToken(payload);

        const newDecoded =
            tokenService.verifyRefreshToken(newRefreshToken);

        const newRefreshTokenHash =
            sessionService.hashToken(newRefreshToken);

        session.refreshTokenHash = newRefreshTokenHash;
        session.expiresAt = new Date(newDecoded.exp * 1000);
        await session.save();

        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
        };

    }

}

export default new RefreshTokenService();
