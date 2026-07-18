import crypto from "crypto";

import EmailVerificationToken from "../models/EmailVerificationToken.js";

class EmailVerificationTokenService {

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

        await EmailVerificationToken.deleteMany({
            user: userId,
        });

        return EmailVerificationToken.create({
            user: userId,
            tokenHash,
            expiresAt,
        });

    }

    async findByHash(tokenHash) {

        return EmailVerificationToken
            .findOne({
                tokenHash,
            })
            .populate("user");

    }

    async markAsVerified(id) {

        return EmailVerificationToken.findByIdAndUpdate(
            id,
            {
                verifiedAt: new Date(),
            },
            {
                new: true,
            }
        );

    }

    async deleteUserTokens(userId) {

        return EmailVerificationToken.deleteMany({
            user: userId,
        });

    }

    async validateToken(rawToken) {

        const tokenHash = crypto
            .createHash("sha256")
            .update(rawToken)
            .digest("hex");

        const token = await EmailVerificationToken
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

        if (token.verifiedAt) {

            return {
                valid: false,
                reason: "already_verified",
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


export default new EmailVerificationTokenService();
