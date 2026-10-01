import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import consultantProfileService from "../services/consultant-profile.service.js";
import BookingSlotLock from "../models/BookingSlotLock.js";
import { SLOT_GRANULARITY_MINUTES } from "../utils/constants.js";

export const createConsultantProfile = asyncHandler(async (req, res) => {

    const profile = await consultantProfileService.create(req.user._id, req.body);

    return res.status(201).json(
        new ApiResponse(
            201,
            profile,
            "Consultant profile created successfully"
        )
    );

});

export const getMyConsultantProfile = asyncHandler(async (req, res) => {

    const profile = await consultantProfileService.findByUserId(req.user._id);

    if (!profile) {

        return res.status(404).json({

            success: false,

            message: "Consultant profile not found",

        });

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            profile,
            "Consultant profile fetched successfully"
        )
    );

});

export const getConsultantProfileById = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const profile = await consultantProfileService.findById(id, true);

    if (!profile || !profile.isActive || profile.approvalStatus !== "approved") {

        return res.status(404).json({

            success: false,

            message: "Consultant profile not found",

        });

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            profile,
            "Consultant profile fetched successfully"
        )
    );

});

export const updateConsultantProfile = asyncHandler(async (req, res) => {

    const profile = await consultantProfileService.update(req.user._id, req.body);

    return res.status(200).json(
        new ApiResponse(
            200,
            profile,
            "Consultant profile updated successfully"
        )
    );

});

export const searchConsultants = asyncHandler(async (req, res) => {

    const filters = {

        categories: req.query.categories ? req.query.categories.split(",") : [],

        minRate: req.query.minRate ? parseFloat(req.query.minRate) : undefined,

        maxRate: req.query.maxRate ? parseFloat(req.query.maxRate) : undefined,

        availability: req.query.availability,

        location: req.query.location,

        search: req.query.search,

        category: req.query.category,

        sort: req.query.sort,

    };

    const pagination = {

        page: parseInt(req.query.page) || 1,

        limit: parseInt(req.query.limit) || 10,

    };

    const result = await consultantProfileService.findAll(filters, pagination);

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Consultants fetched successfully"
        )
    );

});

export const getBanks = asyncHandler(async (req, res) => {
    const banks = await consultantProfileService.getBanks();

    return res.status(200).json(
        new ApiResponse(
            200,
            banks,
            "Banks fetched successfully"
        )
    );
});

export const verifyAccount = asyncHandler(async (req, res) => {
    const { accountNumber, bankCode } = req.query;

    if (!accountNumber || !bankCode) {
        return res.status(400).json({
            success: false,
            message: "accountNumber and bankCode are required",
        });
    }

    const result = await consultantProfileService.verifyAccount(accountNumber, bankCode);

    return res.status(200).json(
        new ApiResponse(
            200,
            result,
            "Account verified successfully"
        )
    );
});

export const getMyPayoutSettings = asyncHandler(async (req, res) => {
    const payoutSettings = await consultantProfileService.getPayoutSettings(req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            payoutSettings,
            "Payout settings fetched successfully"
        )
    );
});

export const updateMyPayoutSettings = asyncHandler(async (req, res) => {
    const updatedProfile = await consultantProfileService.updatePayoutSettings(req.user._id, req.body);

    const maskedAccountNumber = updatedProfile.accountNumber
        ? "****" + updatedProfile.accountNumber.slice(-4)
        : "";

    return res.status(200).json(
        new ApiResponse(
            200,
            {
                payoutMethod: updatedProfile.payoutMethod,
                bankName: updatedProfile.bankName,
                bankCode: updatedProfile.bankCode,
                accountNumber: maskedAccountNumber,
                accountName: updatedProfile.accountName,
                payoneerId: updatedProfile.payoneerId,
            },
            "Payout settings updated successfully"
        )
    );
});

export const deleteConsultantProfile = asyncHandler(async (req, res) => {

    const profile = await consultantProfileService.delete(req.user._id);

    return res.status(200).json(
        new ApiResponse(
            200,
            null,
            "Consultant profile deleted successfully"
        )
    );

});

// Availability slot endpoints (embedded in ConsultantProfile)

export const getMyAvailabilitySlots = asyncHandler(async (req, res) => {

    const profile = await consultantProfileService.findByUserId(req.user._id);

    if (!profile) {

        return res.status(404).json({

            success: false,

            message: "Consultant profile not found",

        });

    }

    const slots = profile.availabilitySlots.filter(slot => slot.isActive);

    return res.status(200).json(
        new ApiResponse(
            200,
            slots,
            "Availability slots fetched successfully"
        )
    );

});

export const setMyAvailabilitySlots = asyncHandler(async (req, res) => {

    const profile = await consultantProfileService.findByUserId(req.user._id);

    if (!profile) {

        return res.status(404).json({

            success: false,

            message: "Consultant profile not found",

        });

    }

    const slots = await consultantProfileService.setAvailabilitySlots(profile._id, req.body.slots);

    return res.status(200).json(
        new ApiResponse(
            200,
            slots,
            "Availability slots updated successfully"
        )
    );

});

export const deleteMyAvailabilitySlot = asyncHandler(async (req, res) => {

    const profile = await consultantProfileService.findByUserId(req.user._id);

    if (!profile) {

        return res.status(404).json({

            success: false,

            message: "Consultant profile not found",

        });

    }

    const { slotId } = req.params;

    const slots = await consultantProfileService.deleteAvailabilitySlot(profile._id, slotId);

    return res.status(200).json(
        new ApiResponse(
            200,
            slots,
            "Availability slot deleted successfully"
        )
    );

});

// Public: Get availability slots for a consultant profile (for booking page)
export const getPublicAvailabilitySlots = asyncHandler(async (req, res) => {

    const { id } = req.params;

    const profile = await consultantProfileService.findById(id);

    if (!profile || !profile.isActive || profile.approvalStatus !== "approved") {

        return res.status(404).json({

            success: false,

            message: "Consultant profile not found",

        });

    }

    const slots = profile.availabilitySlots.filter(slot => slot.isActive);

    return res.status(200).json(
        new ApiResponse(
            200,
            slots,
            "Availability slots fetched successfully"
        )
    );

});

// Public: Get available booking slots for a specific date
export const getAvailableSlotsForDate = asyncHandler(async (req, res) => {

    const { profileId } = req.params;
    const { date, duration } = req.query;

    if (!date) {

        return res.status(400).json({

            success: false,

            message: "date is required",

        });

    }

    // Parse and validate duration
    let parsedDuration = null;
    if (duration !== undefined) {
        const durationNum = parseInt(duration, 10);
        if (Number.isNaN(durationNum) || durationNum <= 0) {
            return res.status(400).json({
                success: false,
                message: "duration must be a positive integer (minutes)",
            });
        }
        if (durationNum % SLOT_GRANULARITY_MINUTES !== 0) {
            return res.status(400).json({
                success: false,
                message: `duration must be a multiple of ${SLOT_GRANULARITY_MINUTES} minutes`,
            });
        }
        parsedDuration = durationNum;
    }

    const profile = await consultantProfileService.findById(profileId);

    if (!profile || !profile.isActive || profile.approvalStatus !== "approved") {

        return res.status(404).json({

            success: false,

            message: "Consultant profile not found",

        });

    }

    const [year, month, day] = date.split("-").map(Number);
    const targetDate = new Date(Date.UTC(year, month - 1, day));
    const dayOfWeek = targetDate.getUTCDay();

    // Get slots for the requested day
    const slots = profile.availabilitySlots.filter(
        slot => slot.dayOfWeek === dayOfWeek && slot.isActive
    );

    if (slots.length === 0) {

        return res.status(200).json(
            new ApiResponse(
                200,
                [],
                "No availability for this date"
            )
        );

    }

    // Query existing slot locks for this date to exclude already-booked slots
    const lockedSlots = await BookingSlotLock.find({
        consultantProfileId: profileId,
        date: date,
    }).select("slotStart -_id");

    const lockedSlotStarts = new Set(lockedSlots.map(lock => lock.slotStart));

    // Generate 30-minute intervals, filtered by duration and locked slots
    const availableSlots = [];

    for (const slot of slots) {

        const [startHours, startMins] = slot.startTime.split(":").map(Number);
        const [endHours, endMins] = slot.endTime.split(":").map(Number);
        const startMinutes = startHours * 60 + startMins;
        const endMinutes = endHours * 60 + endMins;

        for (let mins = startMinutes; mins < endMinutes; mins += SLOT_GRANULARITY_MINUTES) {

            const hours = Math.floor(mins / 60);
            const minutes = mins % 60;
            const slotStart = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

            // If duration is specified, check that the full duration fits
            // within the availability window and that all required slots are free
            if (parsedDuration !== null) {
                const requiredSlots = parsedDuration / SLOT_GRANULARITY_MINUTES;
                const bookingEndMinutes = mins + parsedDuration;

                // Check that the entire duration fits within this availability window
                if (bookingEndMinutes > endMinutes) {
                    continue;
                }

                // Check that all required consecutive slots are unclaimed
                let allSlotsFree = true;
                for (let s = 0; s < requiredSlots; s++) {
                    const checkMinutes = mins + s * SLOT_GRANULARITY_MINUTES;
                    const checkHours = Math.floor(checkMinutes / 60);
                    const checkMins = checkMinutes % 60;
                    const checkSlotStart = `${String(checkHours).padStart(2, "0")}:${String(checkMins).padStart(2, "0")}`;
                    if (lockedSlotStarts.has(checkSlotStart)) {
                        allSlotsFree = false;
                        break;
                    }
                }

                if (!allSlotsFree) {
                    continue;
                }
            }

            const endHoursCalc = Math.floor((mins + SLOT_GRANULARITY_MINUTES) / 60);
            const endMinsCalc = (mins + SLOT_GRANULARITY_MINUTES) % 60;
            const slotEnd = `${String(endHoursCalc).padStart(2, "0")}:${String(endMinsCalc).padStart(2, "0")}`;

            availableSlots.push({

                time: slotStart,

                endTime: slotEnd,

            });

        }

    }

    return res.status(200).json(
        new ApiResponse(
            200,
            availableSlots,
            "Available slots fetched successfully"
        )
    );

});
