import User from "../models/User.js";
import sessionService from "./session.service.js";
import ApiError from "../utils/ApiError.js";

class UserService {

    async create(userData) {
        return await User.create(userData);
    }

    async findById(id) {
        return await User.findById(id);
    }

    async findByIdWithPassword(id) {
        return await User.findById(id).select("+password");
    }

    async findByEmail(email) {
        return await User.findOne({ email });
    }

    async findByEmailWithPassword(email) {
        return await User.findOne({ email }).select("+password");
    }

    async update(id, data) {
        return await User.findByIdAndUpdate(
            id,
            data,
            {
                new: true,
                runValidators: true,
            }
        );
    }

    async deactivate(id) {
        return await User.findByIdAndUpdate(
            id,
            {
                isActive: false,
            },
            {
                new: true,
            }
        );
    }

    async getCurrentUser(id) {

        return await User.findById(id);

    }

    async updateProfile(id, data) {

        return await User.findByIdAndUpdate(
            id,
            data,
            {
                new: true,
                runValidators: true,
            }
        );

    }

    async changePassword(id, currentPassword, newPassword) {

        const user = await User.findById(id).select("+password");

        if (!user) {

            throw new ApiError(404, "User not found");

        }

        const isMatch = await user.comparePassword(currentPassword);

        if (!isMatch) {

            throw new ApiError(401, "Current password is incorrect");

        }

        user.password = newPassword;

        // Invalidate all previously issued stateless access tokens by recording
        // the password-change time. The auth middleware rejects tokens whose `iat`
        // predates this timestamp.
        user.passwordChangedAt = new Date();

        await user.save();

        // Revoke all existing refresh-token sessions so that previously issued
        // refresh tokens can no longer be rotated.
        await sessionService.revokeAllSessions(id);

        return user;

    }

    async uploadAvatar(id, avatar) {

        return await User.findByIdAndUpdate(
            id,
            { avatar },
            {
                new: true,
                runValidators: true,
            }
        );

    }

    async deleteAvatar(id) {

        const user = await User.findById(id);

        if (!user) {

            throw new Error("User not found");

        }

        const publicId = user.avatar?.publicId;

        user.avatar = {

            url: "",

            publicId: "",

        };

        await user.save();

        return { publicId };

    }

    async deleteAccount(id) {

        return await User.findByIdAndUpdate(
            id,
            {
                isActive: false,
            },
            {
                new: true,
            }
        );

    }

}

export default new UserService();