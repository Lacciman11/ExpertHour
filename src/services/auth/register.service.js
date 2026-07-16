import ApiError from "../../utils/ApiError.js";

import userService from "../user.service.js";
import tokenService from "../token.service.js";
import sessionService from "../session.service.js";

const register = async ({
    firstName,
    lastName,
    email,
    password,
    role,
    ipAddress,
    userAgent,
    deviceName,
}) => {

    const existingUser = await userService.findByEmail(email);

    if (existingUser) {
        throw new ApiError(409, "Email already exists");
    }

    const user = await userService.create({
        firstName,
        lastName,
        email,
        password,
        role,
    });

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
        deviceName,
    });

    return {
        user,
        accessToken,
        refreshToken,
    };
};

export default register;