import jwt from "jsonwebtoken";

import authConfig from "../config/auth.js";

import ApiError from "../utils/ApiError.js";

import User from "../models/User.js";

const authenticate = async (req, res, next) => {

    const accessToken = req.cookies.accessToken;

    if (!accessToken) {

        throw new ApiError(401, "Unauthorized");

    }

    try {

        const decoded = jwt.verify(
            accessToken,
            authConfig.accessToken.secret
        );

        const user = await User.findById(decoded.userId);

        if (!user) {

            throw new ApiError(401, "Unauthorized");

        }

        req.user = user;

        next();

    } catch (error) {

        throw new ApiError(401, "Invalid or expired token");

    }

};

export default authenticate;
