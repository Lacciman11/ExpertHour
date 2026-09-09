import jwt from "jsonwebtoken";
import crypto from "crypto";
import authConfig from "../config/auth.js";
import ApiError from "../utils/ApiError.js";

class TokenService {

    generateAccessToken(payload) {
        return jwt.sign(
            payload,
            authConfig.accessToken.secret,
            {
                expiresIn: authConfig.accessToken.expiresIn,
            }
        );
    }

    generateRefreshToken(payload) {
        // Add a unique jti (JWT ID) to ensure each token is unique
        // This prevents token collisions when the same user refreshes multiple times
        const tokenPayload = {
            ...payload,
            jti: crypto.randomUUID(),
        };

        return jwt.sign(
            tokenPayload,
            authConfig.refreshToken.secret,
            {
                expiresIn: authConfig.refreshToken.expiresIn,
            }
        );
    }

    verifyAccessToken(token) {
        try {
            return jwt.verify(
                token,
                authConfig.accessToken.secret
            );
        } catch (error) {
            throw new ApiError(401, "Invalid or expired access token");
        }
    }

    verifyRefreshToken(token) {
        try {
            return jwt.verify(
                token,
                authConfig.refreshToken.secret
            );
        } catch (error) {
            throw new ApiError(401, "Invalid or expired refresh token");
        }
    }

    decodeToken(token) {
        return jwt.decode(token);
    }

}

export default new TokenService();
