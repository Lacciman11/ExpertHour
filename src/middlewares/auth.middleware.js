import jwt from "jsonwebtoken";

import authConfig from "../config/auth.js";

import ApiError from "../utils/ApiError.js";

import User from "../models/User.js";

const authenticate = async (req, res, next) => {

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {

        throw new ApiError(401, "Unauthorized");

    }

    const token = authHeader.split(" ")[1];

    try {

        const decoded = jwt.verify(
            token,
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
