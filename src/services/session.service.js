import crypto from "crypto";
import Session from "../models/Session.js";

class SessionService {

    hashToken(token) {
        return crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");
    }

    async createSession({
        userId,
        refreshToken,
        expiresAt,
        deviceName,
        ipAddress,
        userAgent,
    }) {

        const refreshTokenHash =
            this.hashToken(refreshToken);

        return Session.create({
            user: userId,
            refreshTokenHash,
            expiresAt,
            deviceName,
            ipAddress,
            userAgent,
        });

    }

    async findSession(refreshToken) {

        const refreshTokenHash =
            this.hashToken(refreshToken);

        return Session.findOne({
            refreshTokenHash,
            isRevoked: false,
        });

    }

    async revokeSession(sessionId) {

        return Session.findByIdAndUpdate(
            sessionId,
            {
                isRevoked: true,
            },
            {
                new: true,
            }
        );

    }

    async revokeAllSessions(userId) {

        return Session.updateMany(
            {
                user: userId,
                isRevoked: false,
            },
            {
                isRevoked: true,
            }
        );

    }

    async updateLastUsed(sessionId) {

        return Session.findByIdAndUpdate(
            sessionId,
            {
                lastUsedAt: new Date(),
            }
        );

    }

    async deleteExpiredSessions() {

        return Session.deleteMany({
            expiresAt: {
                $lt: new Date(),
            },
        });

    }

    async findUserSessions(userId) {

        return Session.find({
            user: userId,
            isRevoked: false,
        });

    }

    async deleteSession(sessionId) {

        return Session.findByIdAndDelete(
            sessionId
        );

    }

}


export default new SessionService();