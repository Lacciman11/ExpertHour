import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import User from "../models/User.js";
import ConsultantProfile from "../models/ConsultantProfile.js";

import { BOOKING_STATUS } from "../utils/constants.js";

class BookingService {

    async create(clientId, data) {
        const {
            consultantId,
            consultantProfileId,
            date,
            time,
            duration,
            amount,
            notes,
        } = data;

        const consultant = await User.findById(consultantId);

        if (!consultant || consultant.role !== "CONSULTANT") {
            throw new Error("Consultant not found");
        }

        const profile = await ConsultantProfile.findById(consultantProfileId);

        if (!profile || !profile.isActive) {
            throw new Error("Consultant profile not found or inactive");
        }

        const booking = await Booking.create({
            clientId,
            consultantId,
            consultantProfileId,
            date,
            time,
            duration,
            amount,
            notes: notes || "",
            status: BOOKING_STATUS.PENDING,
        });

        return booking;
    }

    async findById(id) {
        return await Booking.findById(id)
            .populate("clientId", "firstName lastName email")
            .populate("consultantId", "firstName lastName email")
            .populate("consultantProfileId", "hourlyRate skills");
    }

    async findClientBookings(clientId, filters = {}) {
        const query = { clientId };

        if (filters.status) {
            query.status = filters.status;
        }

        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const skip = (page - 1) * limit;

        const bookings = await Booking.find(query)
            .populate("consultantId", "firstName lastName")
            .populate("consultantProfileId", "hourlyRate skills")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Booking.countDocuments(query);

        return {
            bookings,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async findConsultantBookings(consultantId, filters = {}) {
        const query = { consultantId };

        if (filters.status) {
            query.status = filters.status;
        }

        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const skip = (page - 1) * limit;

        const bookings = await Booking.find(query)
            .populate("clientId", "firstName lastName email")
            .populate("consultantProfileId", "hourlyRate skills")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Booking.countDocuments(query);

        return {
            bookings,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async findUpcomingBookings(clientId) {
        const now = new Date();
        const today = now.toISOString().split("T")[0];

        return await Booking.find({
            clientId,
            status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED] },
            date: { $gte: today },
        })
            .populate("consultantId", "firstName lastName")
            .populate("consultantProfileId", "hourlyRate skills")
            .sort({ date: 1, time: 1 })
            .limit(5);
    }

    async updateStatus(id, status) {
        const booking = await Booking.findByIdAndUpdate(
            id,
            { status },
            { new: true, runValidators: true }
        );

        if (!booking) {
            throw new Error("Booking not found");
        }

        return booking;
    }

    async cancel(id, userId) {
        const booking = await Booking.findById(id);

        if (!booking) {
            throw new Error("Booking not found");
        }

        if (booking.clientId.toString() !== userId.toString()) {
            throw new Error("Not authorized to cancel this booking");
        }

        if (booking.status === BOOKING_STATUS.CANCELLED) {
            throw new Error("Booking is already cancelled");
        }

        if (booking.status === BOOKING_STATUS.COMPLETED) {
            throw new Error("Cannot cancel a completed booking");
        }

        booking.status = BOOKING_STATUS.CANCELLED;
        await booking.save();

        return booking;
    }

    async findAll(filters = {}) {
        const query = {};

        if (filters.status) {
            query.status = filters.status;
        }

        if (filters.consultantId) {
            query.consultantId = filters.consultantId;
        }

        if (filters.clientId) {
            query.clientId = filters.clientId;
        }

        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const skip = (page - 1) * limit;

        const bookings = await Booking.find(query)
            .populate("clientId", "firstName lastName email")
            .populate("consultantId", "firstName lastName email")
            .populate("consultantProfileId", "hourlyRate skills")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Booking.countDocuments(query);

        return {
            bookings,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async getStats(consultantId) {
        const totalBookings = await Booking.countDocuments({ consultantId });
        const pendingBookings = await Booking.countDocuments({
            consultantId,
            status: BOOKING_STATUS.PENDING,
        });
        const confirmedBookings = await Booking.countDocuments({
            consultantId,
            status: BOOKING_STATUS.CONFIRMED,
        });
        const completedBookings = await Booking.countDocuments({
            consultantId,
            status: BOOKING_STATUS.COMPLETED,
        });
        const cancelledBookings = await Booking.countDocuments({
            consultantId,
            status: BOOKING_STATUS.CANCELLED,
        });

        const revenueResult = await Booking.aggregate([
            {
                $match: {
                    consultantId: new mongoose.Types.ObjectId(consultantId),
                    status: BOOKING_STATUS.COMPLETED,
                },
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: "$amount" },
                },
            },
        ]);

        const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

        return {
            totalBookings,
            pendingBookings,
            confirmedBookings,
            completedBookings,
            cancelledBookings,
            totalRevenue,
        };
    }
}

export default new BookingService();
