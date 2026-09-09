import jwt from "jsonwebtoken";

import authConfig from "../config/auth.js";

import ApiError from "../utils/ApiError.js";

import User from "../models/User.js";

const authenticate = (options = {}) => {

    const { skipEmailVerification = false } = options;

    return async (req, res, next) => {

        const authHeader = req.headers.authorization

        const tokenFromHeader = authHeader && authHeader.startsWith("Bearer ")
            ? authHeader.slice(7)
            : null

        const accessToken = tokenFromHeader || req.cookies.accessToken

        if (!accessToken) {

            throw new ApiError(401, "Unauthorized")

        }

        try {

            const decoded = jwt.verify(
                accessToken,
                authConfig.accessToken.secret
            )

            const user = await User.findById(decoded.userId)

            if (!user) {

                throw new ApiError(401, "Unauthorized")

            }

            // Invalidate stateless access tokens issued before the last
            // password change. The token's `iat` (seconds) is compared against
            // the passwordChangedAt time. Tokens issued at a second strictly
            // before the change are rejected; tokens issued in the same second
            // or later are accepted so that a fresh login immediately after the
            // password change works without requiring a wait.
            if (
                user.passwordChangedAt &&
                decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
            ) {

                throw new ApiError(401, "Invalid or expired token")

            }

            if (!user.isVerified && !skipEmailVerification) {

                throw new ApiError(403, "Email not verified. Please verify your account before accessing this resource.")

            }

            req.user = user

            next()

        } catch (error) {

            throw new ApiError(401, "Invalid or expired token")

        }

    }

}

export default authenticate;
