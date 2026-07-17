import ApiError from "../../utils/ApiError.js";

import userService from "../user.service.js";
import tokenService from "../token.service.js";
import sessionService from "../session.service.js";

const login = async ({
    email,
    password,
    ipAddress,
    userAgent,
}) => {

    const user =
        await userService.findByEmailWithPassword(email);

    if (!user) {
        throw new ApiError(
            401,
            "Invalid email or password"
        );
    }

    const isMatch =
        await user.comparePassword(password);

    if (!isMatch) {
        throw new ApiError(
            401,
            "Invalid email or password"
        );
    }

    if (!user.isActive) {
        throw new ApiError(
            403,
            "Account has been disabled"
        );
    }

    const payload = {
        userId: user._id,
        role: user.role,
    };

    const accessToken =
        tokenService.generateAccessToken(payload);

    const refreshToken =
        tokenService.generateRefreshToken(payload);

    const decoded =
        tokenService.verifyRefreshToken(refreshToken);

    await sessionService.createSession({

        userId: user._id,

        refreshToken,

        expiresAt: new Date(decoded.exp * 1000),

        ipAddress,

        userAgent,

    });

    await userService.update(
        user._id,
        {
            lastLogin: new Date(),
        }
    );

    const userResponse =
        user.toObject();

    delete userResponse.password;

    return {

        user: userResponse,

        accessToken,

        refreshToken,

    };

};

export default login;