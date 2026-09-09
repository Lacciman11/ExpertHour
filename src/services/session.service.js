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

        // Generate a unique token family for this session
        const tokenFamily = Session.generateTokenFamily();

        return Session.create({
            user: userId,
            refreshTokenHash,
            tokenFamily,
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

    /**
     * Find a session by its previous token hash (for reuse detection).
     * Returns the session if the hash matches a previous token, null otherwise.
     */
    async findSessionByPreviousTokenHash(refreshToken) {

        const refreshTokenHash =
            this.hashToken(refreshToken);

        return Session.findOne({
            previousTokenHash: refreshTokenHash,
            isRevoked: false,
        });

    }

    /**
     * Rotate refresh token atomically.
     * Uses MongoDB's atomic findOneAndUpdate to prevent race conditions.
     * Stores the old hash in previousTokenHash for reuse detection.
     *
     * @param {string} sessionId - The session ID
     * @param {string} oldRefreshTokenHash - The current refresh token hash (for atomic check)
     * @param {string} newRefreshToken - The new refresh token (raw)
     * @param {Date} newExpiresAt - The new expiration date
     * @returns {object|null} Updated session or null if atomic update failed
     */
    async rotateTokenAtomic(sessionId, oldRefreshTokenHash, newRefreshToken, newExpiresAt) {

        const newRefreshTokenHash =
            this.hashToken(newRefreshToken);

        // Atomically update only if the current hash matches and session is not revoked
        // This prevents concurrent refresh requests from both succeeding
        const session = await Session.findOneAndUpdate(
            {
                _id: sessionId,
                refreshTokenHash: oldRefreshTokenHash,
                isRevoked: false,
            },
            {
                $set: {
                    previousTokenHash: oldRefreshTokenHash,
                    refreshTokenHash: newRefreshTokenHash,
                    expiresAt: newExpiresAt,
                    lastUsedAt: new Date(),
                },
            },
            {
                new: true,
            }
        );

        return session;

    }

    /**
     * Revoke all sessions in a token family.
     * Used when token reuse is detected to invalidate the entire token chain.
     *
     * @param {string} tokenFamily - The token family ID to revoke
     * @returns {object} Update result
     */
    async revokeTokenFamily(tokenFamily) {

        return Session.updateMany(
            {
                tokenFamily,
                isRevoked: false,
            },
            {
                isRevoked: true,
            }
        );

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
