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

        if (filters.categories && filters.categories.length > 0) {

            query.categories = { $in: filters.categories };

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

        if (filters.category) {

            // Find category ID by name, then filter consultants
            const Category = (await import("../models/Category.js")).default;
            const categoryDoc = await Category.findOne({ name: filters.category });
            if (categoryDoc) {
                query.categories = categoryDoc._id;
            }

        }

        // Use aggregation when search is present to search across populated fields
        if (filters.search) {

            const searchRegex = { $regex: filters.search, $options: "i" };

            const pipeline = [
                { $match: query },
                {
                    $lookup: {
                        from: "users",
                        localField: "userId",
                        foreignField: "_id",
                        as: "userId"
                    }
                },
                { $unwind: "$userId" },
                {
                    $lookup: {
                        from: "categories",
                        localField: "categories",
                        foreignField: "_id",
                        as: "categories"
                    }
                },
                {
                    $match: {
                        $or: [
                            { bio: searchRegex },
                            { location: searchRegex },
                            { "userId.firstName": searchRegex },
                            { "userId.lastName": searchRegex },
                            { "categories.name": searchRegex }
                        ]
                    }
                },
                { $skip: skip },
                { $limit: limit },
                { $sort: { rating: -1, createdAt: -1 } }
            ];

            const [profiles, total] = await Promise.all([

                ConsultantProfile.aggregate(pipeline),

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

        const [profiles, total] = await Promise.all([

            ConsultantProfile.find(query)

                .populate("userId", "firstName lastName email avatar")
                .populate("categories", "name")

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
