import crypto from "crypto";

import PasswordResetToken from "../models/PasswordResetToken.js";

class PasswordResetTokenService {

    generateToken() {

        const rawToken =
            crypto.randomBytes(32).toString("hex");

        const tokenHash =
            crypto
                .createHash("sha256")
                .update(rawToken)
                .digest("hex");

        return {
            rawToken,
            tokenHash,
        };

    }

    async create({
        userId,
        tokenHash,
        expiresAt,
    }) {

        await PasswordResetToken.deleteMany({
            user: userId,
        });

        return PasswordResetToken.create({
            user: userId,
            tokenHash,
            expiresAt,
        });

    }

    async findByHash(tokenHash) {

        return PasswordResetToken
            .findOne({
                tokenHash,
            })
            .populate("user");

    }

    async markAsUsed(id) {

        return PasswordResetToken.findByIdAndUpdate(
            id,
            {
                usedAt: new Date(),
            },
            {
                new: true,
            }
        );

    }

    async deleteUserTokens(userId) {

        return PasswordResetToken.deleteMany({
            user: userId,
        });

    }

    async validateToken(rawToken) {

    const tokenHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");

    const token = await PasswordResetToken
            .findOne({
                tokenHash,
            })
            .populate("user");

        if (!token) {

            return {
                valid: false,
                reason: "invalid",
            };

        }

        if (token.usedAt) {

            return {
                valid: false,
                reason: "used",
            };

        }

        if (token.expiresAt < new Date()) {

            return {
                valid: false,
                reason: "expired",
            };

        }

        return {

            valid: true,

            token,

        };

    }

}

export default new PasswordResetTokenService();