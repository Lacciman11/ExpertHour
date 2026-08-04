import ConsultantProfile from "../models/ConsultantProfile.js";
import Category from "../models/Category.js";

class ConsultantProfileService {

    async create(userId, data) {

        const existing = await ConsultantProfile.findOne({ userId });

        if (existing) {

            throw new Error("Consultant profile already exists");

        }

        return await ConsultantProfile.create({ userId, ...data });

    }

    async findById(id, populate = false) {

        let query = ConsultantProfile.findById(id);

        if (populate) {
            query = query
                .populate("userId", "firstName lastName email avatar")
                .populate("categories", "name");
        }

        return await query;

    }

    async findByUserId(userId) {

        return await ConsultantProfile.findOne({ userId })
            .populate("userId", "firstName lastName email avatar")
            .populate("categories", "name");

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
                            { firstName: searchRegex },
                            { lastName: searchRegex },
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

    // Availability slot methods (embedded in ConsultantProfile)

    async getAvailabilitySlots(profileId) {

        const profile = await ConsultantProfile.findById(profileId);

        if (!profile) {

            throw new Error("Consultant profile not found");

        }

        return profile.availabilitySlots.filter(slot => slot.isActive);

    }

    async setAvailabilitySlots(profileId, slots) {

        const profile = await ConsultantProfile.findById(profileId);

        if (!profile) {

            throw new Error("Consultant profile not found");

        }

        // Validate time ranges
        for (const slot of slots) {

            if (this._timeToMinutes(slot.endTime) <= this._timeToMinutes(slot.startTime)) {

                throw new Error("End time must be after start time");

            }

        }

        profile.availabilitySlots = slots.map(slot => ({

            dayOfWeek: slot.dayOfWeek,

            startTime: slot.startTime,

            endTime: slot.endTime,

            isActive: true,

        }));

        await profile.save();

        return profile.availabilitySlots;

    }

    async deleteAvailabilitySlot(profileId, slotIndex) {

        const profile = await ConsultantProfile.findById(profileId);

        if (!profile) {

            throw new Error("Consultant profile not found");

        }

        if (slotIndex < 0 || slotIndex >= profile.availabilitySlots.length) {

            throw new Error("Invalid slot index");

        }

        profile.availabilitySlots.splice(slotIndex, 1);

        await profile.save();

        return profile.availabilitySlots;

    }

    _timeToMinutes(time) {

        const [hours, minutes] = time.split(":").map(Number);

        return hours * 60 + minutes;

    }

    _minutesToTime(minutes) {

        const hours = Math.floor(minutes / 60);

        const mins = minutes % 60;

        return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;

    }

}

export default new ConsultantProfileService();
