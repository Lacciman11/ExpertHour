import jwt from "jsonwebtoken";
import authConfig from "../config/auth.js";

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
        return jwt.sign(
            payload,
            authConfig.refreshToken.secret,
            {
                expiresIn: authConfig.refreshToken.expiresIn,
            }
        );
    }

    verifyAccessToken(token) {
        return jwt.verify(
            token,
            authConfig.accessToken.secret
        );
    }

    verifyRefreshToken(token) {
        return jwt.verify(
            token,
            authConfig.refreshToken.secret
        );
    }

    decodeToken(token) {
        return jwt.decode(token);
    }

}

export default new TokenService();