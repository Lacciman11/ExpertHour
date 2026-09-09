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

        // Verify the JWT token structure and expiration
        const decoded = tokenService.verifyRefreshToken(refreshToken);

        // Calculate the hash of the presented token
        const presentedTokenHash = sessionService.hashToken(refreshToken);

        // Find the session by the current token hash
        let session = await sessionService.findSession(refreshToken);

        // If session not found by current hash, check if this is a reused token
        if (!session) {

            // Check if the token matches a previous token hash (reuse detection)
            const sessionWithPreviousToken =
                await sessionService.findSessionByPreviousTokenHash(refreshToken);

            if (sessionWithPreviousToken) {

                // TOKEN REUSE DETECTED!
                // This token was already rotated - potential compromise
                // Revoke the entire token family to prevent further use
                await sessionService.revokeTokenFamily(
                    sessionWithPreviousToken.tokenFamily
                );

                // Log the security event (in production, use proper logger)
                console.warn(
                    `Refresh token reuse detected for user ${sessionWithPreviousToken.user}. ` +
                    `Token family ${sessionWithPreviousToken.tokenFamily} revoked.`
                );

                throw new ApiError(401, "Invalid refresh token");

            }

            // Token doesn't match any current or previous hash
            throw new ApiError(401, "Invalid refresh token");

        }

        // Check session expiration
        if (session.expiresAt < new Date()) {

            throw new ApiError(401, "Refresh token expired");

        }

        // Verify user still exists and is active
        const user = await userService.findById(decoded.userId);

        if (!user || !user.isActive) {

            throw new ApiError(401, "User not found or inactive");

        }

        if (!user.isVerified) {

            throw new ApiError(403, "Email not verified");

        }

        const payload = {
            userId: user._id,
            role: user.role,
        };

        // Generate new tokens
        const newAccessToken =
            tokenService.generateAccessToken(payload);

        const newRefreshToken =
            tokenService.generateRefreshToken(payload);

        const newDecoded =
            tokenService.verifyRefreshToken(newRefreshToken);

        const newExpiresAt = new Date(newDecoded.exp * 1000);

        // Atomically rotate the token
        // This ensures only one concurrent refresh succeeds
        const updatedSession = await sessionService.rotateTokenAtomic(
            session._id,
            presentedTokenHash,
            newRefreshToken,
            newExpiresAt
        );

        if (!updatedSession) {

            // Atomic update failed - likely due to concurrent refresh
            // or the session was revoked between fetch and update
            throw new ApiError(401, "Invalid refresh token");

        }

        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
        };

    }

}

export default new RefreshTokenService();
