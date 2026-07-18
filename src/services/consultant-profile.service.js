import ConsultantProfile from "../models/ConsultantProfile.js";

class ConsultantProfileService {

    async create(userId, data) {

        const existing = await ConsultantProfile.findOne({ userId });

        if (existing) {

            throw new Error("Consultant profile already exists");

        }

        return await ConsultantProfile.create({ userId, ...data });

    }

    async findById(id) {

        return await ConsultantProfile.findById(id);

    }

    async findByUserId(userId) {

        return await ConsultantProfile.findOne({ userId });

    }

    async findAll(filters = {}, pagination = {}) {

        const { page = 1, limit = 10 } = pagination;

        const skip = (page - 1) * limit;

        const query = { isActive: true };

        if (filters.skills && filters.skills.length > 0) {

            query.skills = { $in: filters.skills };

        }

        if (filters.minRate !== undefined) {

            query.hourlyRate = { $gte: filters.minRate };

        }

        if (filters.maxRate !== undefined) {

            query.hourlyRate = { ...query.hourlyRate, $lte: filters.maxRate };

        }

        if (filters.availability) {

            query.availability = filters.availability;

        }

        if (filters.location) {

            query.location = { $regex: filters.location, $options: "i" };

        }

        const [profiles, total] = await Promise.all([

            ConsultantProfile.find(query)

                .populate("userId", "firstName lastName email avatar")

                .skip(skip)

                .limit(limit)

                .sort({ rating: -1, createdAt: -1 }),

            ConsultantProfile.countDocuments(query),

        ]);

        return {

            profiles,

            total,

            page,

            limit,

            totalPages: Math.ceil(total / limit),

        };

    }

    async update(userId, data) {

        return await ConsultantProfile.findOneAndUpdate(

            { userId },

            data,

            {

                new: true,

                runValidators: true,

            }

        );

    }

    async delete(userId) {

        return await ConsultantProfile.findOneAndUpdate(

            { userId },

            { isActive: false },

            { new: true }

        );

    }

    async updateRating(userId, newRating) {

        const profile = await ConsultantProfile.findOne({ userId });

        if (!profile) {

            throw new Error("Consultant profile not found");

        }

        const totalRating = profile.rating * profile.reviewCount + newRating;

        profile.reviewCount += 1;

        profile.rating = totalRating / profile.reviewCount;

        await profile.save();

        return profile;

    }

}

export default new ConsultantProfileService();
