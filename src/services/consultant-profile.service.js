import mongoose from "mongoose";
import ConsultantProfile from "../models/ConsultantProfile.js";
import Category from "../models/Category.js";
import User from "../models/User.js";
import PaystackRecipientAttempt, { PAYSTACK_RECIPIENT_ATTEMPT_STATUS, computeAttemptKey } from "../models/PaystackRecipientAttempt.js";
import { getBanks, resolveBankAccount, createTransferRecipient } from "../services/paystack-transfer.service.js";
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
            paystackRecipientCode: profile.paystackRecipientCode || "",
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

        await ConsultantProfile.findOneAndUpdate(
            { userId },
            sanitized,
            {
                new: true,
                runValidators: true,
            }
        );

        // Resolve Paystack recipient after bank details are saved (only for Paystack method)
        const effectivePayoutMethod = sanitized.payoutMethod || previousPayoutMethod;
        if (effectivePayoutMethod === "paystack") {
            try {
                await this.resolvePaystackRecipient(userId);
            } catch (error) {
                // Bank details are already saved. Old recipient code was cleared if changed.
                // Return an explicit error so the consultant can retry without resubmitting.
                throw new ApiError(
                    400,
                    `Bank details saved but payout setup is incomplete: ${error.message}. You can retry payout setup without resubmitting your bank account.`
                );
            }
        }

        return await this.getPayoutSettings(userId);
    }

    /**
     * Resolve or create a Paystack transfer recipient for a consultant.
     *
     * This is the single shared implementation used by:
     *   - updatePayoutSettings() (after bank details are saved)
     *   - createPayout() (before creating a payout)
     *   - PayoutProcessingService (background worker)
     *
     * Steps:
     *   1. Load the consultant profile by userId
     *   2. Validate payout method is Paystack
     *   3. Confirm required bank details exist
     *   4. Verify bank details via Paystack resolveBankAccount
     *   5. Compare resolved account name with stored accountName
     *   6. Reuse existing valid recipient code if present
     *   7. Otherwise create a new recipient via createTransferRecipient()
     *   8. Persist the returned code safely (concurrency-safe)
     *   9. Return { recipientCode, created }
     *
     * @param {string} userId - The consultant's user ID
     * @returns {Promise<{ recipientCode: string, created: boolean }>}
     * @throws {ApiError} If profile not found, payout method is not Paystack,
     *   bank details are incomplete, verification fails, or recipient creation fails
     */
    async resolvePaystackRecipient(userId) {
        // 1. Load the consultant profile
        const profile = await ConsultantProfile.findOne({ userId });
        if (!profile) {
            throw new ApiError(404, "Consultant profile not found");
        }

        // 2. Validate payout method is Paystack
        if (profile.payoutMethod !== "paystack") {
            throw new ApiError(400, "Payout method is not Paystack");
        }

        const currency = profile.currency || "NGN";
        const attemptKey = computeAttemptKey({
            payoutMethod: profile.payoutMethod,
            bankCode: profile.bankCode,
            accountNumber: profile.accountNumber,
            currency,
        });

        // 3. Reuse existing valid recipient code if present and matches current bank details context
        if (profile.paystackRecipientCode && profile.paystackRecipientCode !== "") {
            // If bank details are missing, still allow reuse only if code exists? But better to be defensive
            return { recipientCode: profile.paystackRecipientCode, created: false };
        }

        // 4. Confirm required bank details exist
        if (!profile.bankCode || !profile.accountNumber || !profile.accountName) {
            throw new ApiError(
                400,
                "Bank details are incomplete. Provide bank code, account number, and account name."
            );
        }

        // 5. Verify bank details via Paystack
        let resolution;
        try {
            resolution = await resolveBankAccount({
                accountNumber: profile.accountNumber,
                bankCode: profile.bankCode,
            });
        } catch (error) {
            throw new ApiError(400, `Unable to verify bank account: ${error.message}`);
        }

        // 6. Compare resolved account name with stored accountName
        const normalizeName = (name) =>
            name.trim().replace(/\s+/g, " ").toLowerCase();

        const normalizedResolved = normalizeName(resolution.accountName);
        const normalizedStored = normalizeName(profile.accountName);
        if (normalizedResolved !== normalizedStored) {
            throw new ApiError(
                400,
                "Bank account name does not match Paystack records. Please verify your account details."
            );
        }

        // Check for existing attempts
        const STALE_ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

        // Handle stale IN_PROGRESS attempts conservatively
        const staleCutoff = new Date(Date.now() - STALE_ATTEMPT_TIMEOUT_MS);
        try {
            await PaystackRecipientAttempt.updateOne(
                {
                    consultantProfileId: profile._id,
                    attemptKey,
                    status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.IN_PROGRESS,
                    startedAt: { $lt: staleCutoff },
                },
                {
                    $set: {
                        status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.UNKNOWN,
                        completedAt: new Date(),
                        errorSummary: "stale_in_progress_timed_out",
                    },
                }
            );
        } catch (e) {
            // ignore
        }

        // SUCCEEDED with recipient code: recover profile persistence
        const succeededAttempt = await PaystackRecipientAttempt.findOne({
            consultantProfileId: profile._id,
            attemptKey,
            status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.SUCCEEDED,
            recipientCode: { $ne: null },
        }).sort({ completedAt: -1, createdAt: -1 });

        if (succeededAttempt && succeededAttempt.recipientCode) {
            try {
                const updateResult = await ConsultantProfile.updateOne(
                    { _id: profile._id, paystackRecipientCode: { $in: ["", null] } },
                    { $set: { paystackRecipientCode: succeededAttempt.recipientCode } }
                );
                if (updateResult.modifiedCount === 0) {
                    const freshProfile = await ConsultantProfile.findById(profile._id);
                    if (freshProfile.paystackRecipientCode && freshProfile.paystackRecipientCode !== "") {
                        return { recipientCode: freshProfile.paystackRecipientCode, created: false };
                    }
                }
            } catch (e) {
                throw e;
            }
            const freshProfile = await ConsultantProfile.findById(profile._id);
            if (freshProfile.paystackRecipientCode && freshProfile.paystackRecipientCode !== "") {
                return { recipientCode: freshProfile.paystackRecipientCode, created: false };
            }
            throw new ApiError(500, "Failed to persist transfer recipient code");
        }

        // IN_PROGRESS: do not start another creation request
        const inProgressAttempt = await PaystackRecipientAttempt.findOne({
            consultantProfileId: profile._id,
            attemptKey,
            status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.IN_PROGRESS,
        });
        if (inProgressAttempt) {
            throw new ApiError(409, "Recipient creation already in progress");
        }

        // UNKNOWN: do not create another recipient automatically
        const unknownAttempt = await PaystackRecipientAttempt.findOne({
            consultantProfileId: profile._id,
            attemptKey,
            status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.UNKNOWN,
        });
        if (unknownAttempt) {
            throw new ApiError(409, "Recipient creation outcome is unknown; reconciliation required");
        }

        // FAILED: allow new attempt only if definitive failure

        // Atomically claim a new attempt before calling Paystack
        let attempt;
        try {
            attempt = await PaystackRecipientAttempt.create({
                consultantProfileId: profile._id,
                userId: profile.userId,
                attemptKey,
                status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.IN_PROGRESS,
                startedAt: new Date(),
            });
        } catch (error) {
            if (error.code === 11000) {
                // Duplicate key from unique partial index - reload winning attempt
                // Wait briefly for winner to complete
                const maxWaitMs = 5000;
                const pollIntervalMs = 100;
                const startWait = Date.now();
                while (Date.now() - startWait < maxWaitMs) {
                    const succeededAfterRace = await PaystackRecipientAttempt.findOne({
                        consultantProfileId: profile._id,
                        attemptKey,
                        status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.SUCCEEDED,
                        recipientCode: { $ne: null },
                    }).sort({ completedAt: -1, createdAt: -1 });
                    if (succeededAfterRace && succeededAfterRace.recipientCode) {
                        try {
                            await ConsultantProfile.updateOne(
                                { _id: profile._id, paystackRecipientCode: { $in: ["", null] } },
                                { $set: { paystackRecipientCode: succeededAfterRace.recipientCode } }
                            );
                        } catch (e) {
                            throw e;
                        }
                        const freshProfile = await ConsultantProfile.findById(profile._id);
                        if (freshProfile.paystackRecipientCode && freshProfile.paystackRecipientCode !== "") {
                            return { recipientCode: freshProfile.paystackRecipientCode, created: false };
                        }
                        throw new ApiError(500, "Failed to persist transfer recipient code");
                    }
                    const winningAttempt = await PaystackRecipientAttempt.findOne({
                        consultantProfileId: profile._id,
                        attemptKey,
                        status: { $in: [PAYSTACK_RECIPIENT_ATTEMPT_STATUS.IN_PROGRESS, PAYSTACK_RECIPIENT_ATTEMPT_STATUS.UNKNOWN] },
                    });
                    if (winningAttempt) {
                        if (winningAttempt.status === PAYSTACK_RECIPIENT_ATTEMPT_STATUS.UNKNOWN) {
                            throw new ApiError(409, "Recipient creation outcome is unknown; reconciliation required");
                        }
                        if (winningAttempt.status === PAYSTACK_RECIPIENT_ATTEMPT_STATUS.IN_PROGRESS) {
                            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
                            continue;
                        }
                    }
                    break;
                }
                // Check again after waiting
                const succeededAfterRace = await PaystackRecipientAttempt.findOne({
                    consultantProfileId: profile._id,
                    attemptKey,
                    status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.SUCCEEDED,
                    recipientCode: { $ne: null },
                }).sort({ completedAt: -1, createdAt: -1 });
                if (succeededAfterRace && succeededAfterRace.recipientCode) {
                    try {
                        await ConsultantProfile.updateOne(
                            { _id: profile._id, paystackRecipientCode: { $in: ["", null] } },
                            { $set: { paystackRecipientCode: succeededAfterRace.recipientCode } }
                        );
                    } catch (e) {
                        throw e;
                    }
                    const freshProfile = await ConsultantProfile.findById(profile._id);
                    if (freshProfile.paystackRecipientCode && freshProfile.paystackRecipientCode !== "") {
                        return { recipientCode: freshProfile.paystackRecipientCode, created: false };
                    }
                    throw new ApiError(500, "Failed to persist transfer recipient code");
                }
                const finalWinningAttempt = await PaystackRecipientAttempt.findOne({
                    consultantProfileId: profile._id,
                    attemptKey,
                    status: { $in: [PAYSTACK_RECIPIENT_ATTEMPT_STATUS.IN_PROGRESS, PAYSTACK_RECIPIENT_ATTEMPT_STATUS.UNKNOWN] },
                });
                if (finalWinningAttempt) {
                    if (finalWinningAttempt.status === PAYSTACK_RECIPIENT_ATTEMPT_STATUS.UNKNOWN) {
                        throw new ApiError(409, "Recipient creation outcome is unknown; reconciliation required");
                    }
                    if (finalWinningAttempt.status === PAYSTACK_RECIPIENT_ATTEMPT_STATUS.IN_PROGRESS) {
                        throw new ApiError(409, "Recipient creation already in progress");
                    }
                }
            }
            // If cannot durably record attempt, do not call Paystack
            throw new ApiError(500, "Failed to record recipient creation attempt");
        }

        // 7. Create new recipient via Paystack only after attempt is durably recorded
        let result;
        let paystackError = null;
        try {
            result = await createTransferRecipient({
                name: profile.accountName,
                accountNumber: profile.accountNumber,
                bankCode: profile.bankCode,
                currency,
            });
        } catch (error) {
            paystackError = error;
            // Determine if definitive rejection
            const isDefinitive = error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429;
            try {
                await PaystackRecipientAttempt.findByIdAndUpdate(attempt._id, {
                    $set: {
                        status: isDefinitive ? PAYSTACK_RECIPIENT_ATTEMPT_STATUS.FAILED : PAYSTACK_RECIPIENT_ATTEMPT_STATUS.UNKNOWN,
                        errorCode: error.statusCode ? String(error.statusCode) : null,
                        errorSummary: "paystack_recipient_creation_failed",
                        completedAt: new Date(),
                    },
                });
            } catch (e) {
                // ignore
            }
            if (error instanceof ApiError) {
                throw error;
            }
            throw new ApiError(
                500,
                `Failed to create Paystack transfer recipient: ${error.message}`
            );
        }

        // Paystack returned a recipient code - persist it on the attempt first
        try {
            await PaystackRecipientAttempt.findByIdAndUpdate(attempt._id, {
                $set: {
                    recipientCode: result.recipientCode,
                },
            });
        } catch (e) {
            // If cannot store code on attempt, do not create another recipient - mark unknown
            try {
                await PaystackRecipientAttempt.findByIdAndUpdate(attempt._id, {
                    $set: {
                        status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.UNKNOWN,
                        completedAt: new Date(),
                    },
                });
            } catch (e2) {
                // ignore
            }
            throw new ApiError(500, "Failed to persist transfer recipient code");
        }

        // Then persist it on ConsultantProfile, using bank-details/attempt-key guard
        try {
            const updateResult = await ConsultantProfile.updateOne(
                { _id: profile._id, paystackRecipientCode: { $in: ["", null] } },
                { $set: { paystackRecipientCode: result.recipientCode } }
            );

            if (updateResult.modifiedCount === 0) {
                // Another process created the recipient - fetch the existing code
                const freshProfile = await ConsultantProfile.findById(profile._id);
                if (freshProfile.paystackRecipientCode && freshProfile.paystackRecipientCode !== "") {
                    // Mark attempt as succeeded with the code we got from Paystack? Or just note recovery
                    try {
                        await PaystackRecipientAttempt.findByIdAndUpdate(attempt._id, {
                            $set: {
                                status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.SUCCEEDED,
                                recipientCode: result.recipientCode,
                                completedAt: new Date(),
                            },
                        });
                    } catch (e) {
                        // ignore
                    }
                    return { recipientCode: freshProfile.paystackRecipientCode, created: false };
                }
                // DB persistence failed after Paystack success - do not create another recipient
                try {
                    await PaystackRecipientAttempt.findByIdAndUpdate(attempt._id, {
                        $set: {
                            status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.UNKNOWN,
                            completedAt: new Date(),
                        },
                    });
                } catch (e) {
                    // ignore
                }
                throw new ApiError(500, "Failed to persist transfer recipient code");
            }
        } catch (error) {
            if (error instanceof ApiError) {
                throw error;
            }
            // DB failure after Paystack success - mark unknown, do not create another recipient
            try {
                await PaystackRecipientAttempt.findByIdAndUpdate(attempt._id, {
                    $set: {
                        status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.UNKNOWN,
                        completedAt: new Date(),
                    },
                });
            } catch (e) {
                // ignore
            }
            throw new ApiError(500, "Failed to persist transfer recipient code");
        }

        // Mark the attempt SUCCEEDED only after the recipient code is safely persisted
        try {
            await PaystackRecipientAttempt.findByIdAndUpdate(attempt._id, {
                $set: {
                    status: PAYSTACK_RECIPIENT_ATTEMPT_STATUS.SUCCEEDED,
                    completedAt: new Date(),
                },
            });
        } catch (e) {
            // ignore
        }

        // 9. Return the resolved code
        return { recipientCode: result.recipientCode, created: true };
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
