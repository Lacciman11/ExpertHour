import asyncHandler from "../utils/asyncHandler.js";

import ApiResponse from "../utils/ApiResponse.js";

import consultantProfileService from "../services/consultant-profile.service.js";

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

    if (!profile || !profile.isActive) {

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

    const slots = await consultantProfileService.setAvailabilitySlots(profile._id, req.body);

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

    const { index } = req.params;

    const slots = await consultantProfileService.deleteAvailabilitySlot(profile._id, parseInt(index));

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

    if (!profile || !profile.isActive) {

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
    const { date } = req.query;

    if (!date) {

        return res.status(400).json({

            success: false,

            message: "Date is required",

        });

    }

    const profile = await consultantProfileService.findById(profileId);

    if (!profile || !profile.isActive) {

        return res.status(404).json({

            success: false,

            message: "Consultant profile not found",

        });

    }

    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay();

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

    // Generate 30-minute intervals
    const availableSlots = [];

    for (const slot of slots) {

        const [startHours, startMins] = slot.startTime.split(":").map(Number);
        const [endHours, endMins] = slot.endTime.split(":").map(Number);
        const startMinutes = startHours * 60 + startMins;
        const endMinutes = endHours * 60 + endMins;

        for (let mins = startMinutes; mins < endMinutes; mins += 30) {

            const hours = Math.floor(mins / 60);
            const minutes = mins % 60;
            const slotStart = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

            const endHoursCalc = Math.floor((mins + 30) / 60);
            const endMinsCalc = (mins + 30) % 60;
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
