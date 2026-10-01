import mongoose from "mongoose";
import ConsultantProfile from "../models/ConsultantProfile.js";
import Category from "../models/Category.js";
import User from "../models/User.js";
import { getBanks, resolveBankAccount } from "../services/paystack-transfer.service.js";
import ApiError from "../utils/ApiError.js";

const SORT_MAP = {
    newest: { createdAt: -1, _id: -1 },
    "price-asc": { hourlyRate: 1, _id: 1 },
    "price-desc": { hourlyRate: -1, _id: -1 },
    "name-asc": { firstName: 1, _id: 1 },
};

const DEFAULT_SORT = { createdAt: -1, _id: -1 };

class ConsultantProfileService {

    async create(userId, data) {

        const existing = await ConsultantProfile.findOne({ userId });

        if (existing) {

            throw new Error("Consultant profile already exists");

        }

        const { avatar: _ignoredAvatar, ...rest } = data;

        const user = await User.findById(userId).select("avatar");

        const profileData = {
            userId,
            ...rest,
            approvalStatus: "pending",
            ...(user?.avatar ? { avatar: user.avatar } : {}),
        };

        return await ConsultantProfile.create(profileData);

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

        const sort = SORT_MAP[filters.sort] || DEFAULT_SORT;

        const query = { isActive: true, approvalStatus: "approved" };

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
                { $sort: sort },
                { $skip: skip },
                { $limit: limit },
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

                .sort(sort)

                .skip(skip)

                .limit(limit),

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

        const ALLOWED_FIELDS = new Set([

            "bio",
            "categories",
            "hourlyRate",
            "availability",
            "availabilitySlots",
            "experience",
            "education",
            "certifications",
            "languages",
            "location",
            "website",
            "linkedin",

        ]);

        const sanitized = {};

        for (const key of Object.keys(data)) {

            if (ALLOWED_FIELDS.has(key)) {

                sanitized[key] = data[key];

            }

        }

        return await ConsultantProfile.findOneAndUpdate(

            { userId },

            sanitized,

            {

                new: true,

                runValidators: true,

            }

        );

    }

    async getPayoutSettings(userId) {
        const profile = await ConsultantProfile.findOne({ userId });

        if (!profile) {
            throw new Error("Consultant profile not found");
        }

        const maskedAccountNumber = profile.accountNumber
            ? "****" + profile.accountNumber.slice(-4)
            : "";

        return {
            payoutMethod: profile.payoutMethod || "paystack",
            bankName: profile.bankName || "",
            bankCode: profile.bankCode || "",
            accountNumber: maskedAccountNumber,
            accountName: profile.accountName || "",
            payoneerId: profile.payoneerId || "",
        };
    }

    async updatePayoutSettings(userId, data) {
        const ALLOWED_FIELDS = new Set([
            "payoutMethod",
            "bankName",
            "bankCode",
            "accountNumber",
            "accountName",
            "payoneerId",
        ]);

        const sanitized = {};

        for (const key of Object.keys(data)) {
            if (ALLOWED_FIELDS.has(key)) {
                sanitized[key] = data[key];
            }
        }

        // Determine if bank details are changing
        const profile = await ConsultantProfile.findOne({ userId });
        if (!profile) {
            throw new Error("Consultant profile not found");
        }

        const previousPayoutMethod = profile.payoutMethod;
        const payoutMethodChanged = sanitized.payoutMethod !== undefined && sanitized.payoutMethod !== previousPayoutMethod;

        const bankFieldsChanged =
            sanitized.bankName !== undefined && sanitized.bankName !== profile.bankName ||
            sanitized.bankCode !== undefined && sanitized.bankCode !== profile.bankCode ||
            sanitized.accountNumber !== undefined && sanitized.accountNumber !== profile.accountNumber ||
            sanitized.accountName !== undefined && sanitized.accountName !== profile.accountName;

        // Clear stale recipient when payout method changes or bank details change
        if ((payoutMethodChanged || bankFieldsChanged) && profile.paystackRecipientCode) {
            sanitized.paystackRecipientCode = "";
        }

        // For Paystack bank updates, verify account via Paystack and use verified name
        if (sanitized.payoutMethod === "paystack" || (!sanitized.payoutMethod && previousPayoutMethod === "paystack")) {
            const effectivePayoutMethod = sanitized.payoutMethod || previousPayoutMethod;
            if (effectivePayoutMethod === "paystack") {
                const hasBankUpdate =
                    sanitized.bankCode !== undefined ||
                    sanitized.accountNumber !== undefined;

                if (hasBankUpdate) {
                    const accountNumber = sanitized.accountNumber || profile.accountNumber;
                    const bankCode = sanitized.bankCode || profile.bankCode;

                    if (accountNumber && bankCode) {
                        try {
                            const resolved = await resolveBankAccount({ accountNumber, bankCode });
                            sanitized.accountName = resolved.accountName;
                        } catch (error) {
                            throw new ApiError(400, `Unable to verify account: ${error.message}`);
                        }
                    }
                }
            }
        }

        return await ConsultantProfile.findOneAndUpdate(
            { userId },
            sanitized,
            {
                new: true,
                runValidators: true,
            }
        );
    }

    async getBanks() {
        try {
            return await getBanks();
        } catch (error) {
            throw new ApiError(500, "Failed to fetch bank list");
        }
    }

    async verifyAccount(accountNumber, bankCode) {
        if (!accountNumber || !bankCode) {
            throw new ApiError(400, "accountNumber and bankCode are required");
        }

        try {
            const result = await resolveBankAccount({ accountNumber, bankCode });
            return {
                accountName: result.accountName,
                accountNumber: result.accountNumber,
                bankCode: result.bankCode,
            };
        } catch (error) {
            throw new ApiError(400, "Unable to verify account. Please check the account number and bank code.");
        }
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

            throw new ApiError(404, "Consultant profile not found");

        }

        // Validate each slot
        const timeRegex = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
        for (const slot of slots) {

            if (slot.dayOfWeek < 0 || slot.dayOfWeek > 6) {

                throw new ApiError(400, "Day of week must be between 0 (Sunday) and 6 (Saturday)");

            }

            if (!timeRegex.test(slot.startTime)) {

                throw new ApiError(400, "Invalid start time format (HH:MM)");

            }

            if (!timeRegex.test(slot.endTime)) {

                throw new ApiError(400, "Invalid end time format (HH:MM)");

            }

            if (this._timeToMinutes(slot.endTime) <= this._timeToMinutes(slot.startTime)) {

                throw new ApiError(400, "End time must be after start time");

            }

        }

        // Detect overlapping slots on the same day
        const slotsByDay = {};
        for (const slot of slots) {
            if (!slotsByDay[slot.dayOfWeek]) {
                slotsByDay[slot.dayOfWeek] = [];
            }
            slotsByDay[slot.dayOfWeek].push({
                start: this._timeToMinutes(slot.startTime),
                end: this._timeToMinutes(slot.endTime),
            });
        }

        for (const day in slotsByDay) {
            const daySlots = slotsByDay[day].sort((a, b) => a.start - b.start);
            for (let i = 1; i < daySlots.length; i++) {
                // Overlap if current slot starts before previous slot ends.
                // Adjacent slots (start === previous end) are allowed.
                if (daySlots[i].start < daySlots[i - 1].end) {
                    throw new ApiError(400, "Overlapping time slots are not allowed on the same day");
                }
            }
        }

        profile.availabilitySlots = slots.map(slot => ({
            dayOfWeek: slot.dayOfWeek,
            startTime: slot.startTime,
            endTime: slot.endTime,
            isActive: slot.isActive !== undefined ? slot.isActive : true,
        }));

        await profile.save();

        return profile.availabilitySlots;

    }

    async deleteAvailabilitySlot(profileId, slotId) {

        const profile = await ConsultantProfile.findById(profileId);

        if (!profile) {

            throw new ApiError(404, "Consultant profile not found");

        }

        if (!mongoose.Types.ObjectId.isValid(slotId)) {

            throw new ApiError(400, "Invalid slot ID");

        }

        const slot = profile.availabilitySlots.find(
            (s) => s._id.toString() === slotId
        );

        if (!slot) {

            throw new ApiError(404, "Availability slot not found");

        }

        profile.availabilitySlots.pull(slot);

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
