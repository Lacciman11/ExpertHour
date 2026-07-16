import env from "./env.js";

const authConfig = {
    accessToken: {
        secret: env.jwtAccessSecret,
        expiresIn: "15m",
    },

    refreshToken: {
        secret: env.jwtRefreshSecret,
        expiresIn: "7d",
    },

    bcryptSaltRounds: 12,
};

export default authConfig;