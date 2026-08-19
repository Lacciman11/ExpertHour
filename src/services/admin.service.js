import mongoose from "mongoose";

import User from "../models/User.js";
import ConsultantProfile from "../models/ConsultantProfile.js";
import Booking from "../models/Booking.js";
import Payment from "../models/Payment.js";
import Category from "../models/Category.js";
import { koboToNaira } from "../utils/currency.js";

class AdminService {

    async getDashboardStats() {

        const [
            totalUsers,
            totalConsultants,
            totalBookings,
            revenueResult,
            pendingBookings,
            completedBookings,
            activeUsers,
            bannedUsers,
        ] = await Promise.all([

            User.countDocuments({ role: "BUSINESS_OWNER" }),

            User.countDocuments({ role: "CONSULTANT" }),

            Booking.countDocuments(),

            Booking.aggregate([
                {
                    $match: {
                        status: "completed",
                    },
                },
                {
                    $group: {
                        _id: null,
                        totalRevenue: { $sum: "$amount" },
                    },
                },
            ]),

            Booking.countDocuments({ status: "pending" }),

            Booking.countDocuments({ status: "completed" }),

            User.countDocuments({ isActive: true }),

            User.countDocuments({ isActive: false }),

        ]);

        const totalRevenue = koboToNaira(revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0);

        return {

            totalUsers,
            totalConsultants,
            totalBookings,
            totalRevenue,
            pendingBookings,
            completedBookings,
            activeUsers,
            bannedUsers,

        };

    }

    async getPaymentStats() {

        const [
            totalTransactions,
            successfulPayments,
            failedPayments,
            refundedPayments,
            totalRevenue,
            totalRefunded,
        ] = await Promise.all([

            Payment.countDocuments(),

            Payment.countDocuments({ status: "success" }),

            Payment.countDocuments({ status: "failed" }),

            Payment.countDocuments({ refundStatus: "completed" }),

            Payment.aggregate([
                { $match: { status: "success" } },
                { $group: { _id: null, total: { $sum: "$amount" } } },
            ]),

            Payment.aggregate([
                { $match: { refundStatus: "completed" } },
                { $group: { _id: null, total: { $sum: "$refundAmount" } } },
            ]),

        ]);

        const revenue = koboToNaira(totalRevenue.length > 0 ? totalRevenue[0].total : 0);
        const refunded = koboToNaira(totalRefunded.length > 0 ? totalRefunded[0].total : 0);

        return {

            totalTransactions,
            successfulPayments,
            failedPayments,
            refundedPayments,
            totalRevenue: revenue,
            totalRefunded: refunded,
            netRevenue: revenue - refunded,

        };

    }

    async getAllPayments(filters = {}) {

        const query = {};

        if (filters.paymentStatus) {

            query.status = filters.paymentStatus;

        }

        if (filters.refundStatus) {

            query.refundStatus = filters.refundStatus;

        }

        if (filters.search) {

            const searchRegex = { $regex: filters.search, $options: "i" };

            query.$or = [
                { reference: searchRegex },
                { "clientId.firstName": searchRegex },
                { "clientId.lastName": searchRegex },
                { "clientId.email": searchRegex },
                { "consultantId.firstName": searchRegex },
                { "consultantId.lastName": searchRegex },
                { "consultantId.email": searchRegex },
            ];

        }

        if (filters.startDate || filters.endDate) {

            query.createdAt = {};

            if (filters.startDate) {

                query.createdAt.$gte = new Date(filters.startDate);

            }

            if (filters.endDate) {

                query.createdAt.$lte = new Date(filters.endDate);

            }

        }

        const page = parseInt(filters.page) || 1;

        const limit = parseInt(filters.limit) || 10;

        const skip = (page - 1) * limit;

        const [payments, total] = await Promise.all([

            Payment.find(query)
                .populate("clientId", "firstName lastName email")
                .populate("consultantId", "firstName lastName email")
                .populate("bookingId", "date time duration amount status meetingLink")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),

            Payment.countDocuments(query),

        ]);

        // Convert kobo to Naira for API response
        payments.forEach(payment => {
            payment.amount = koboToNaira(payment.amount);
            if (payment.refundAmount) {
                payment.refundAmount = koboToNaira(payment.refundAmount);
            }
            if (payment.bookingId && payment.bookingId.amount) {
                payment.bookingId.amount = koboToNaira(payment.bookingId.amount);
            }
        });

        return {

            payments,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),

        };

    }

    async getAllUsers(filters = {}) {

        const query = { role: "BUSINESS_OWNER" };

        if (filters.search) {

            const searchRegex = { $regex: filters.search, $options: "i" };

            query.$or = [
                { firstName: searchRegex },
                { lastName: searchRegex },
                { email: searchRegex },
            ];

        }

        if (filters.status) {

            if (filters.status === "banned") {

                query.isActive = false;

            } else if (filters.status === "active") {

                query.isActive = true;

            }

        }

        if (filters.role) {

            query.role = filters.role;

        }

        const page = parseInt(filters.page) || 1;

        const limit = parseInt(filters.limit) || 10;

        const skip = (page - 1) * limit;

        const [users, total] = await Promise.all([

            User.find(query)
                .select("-password")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),

            User.countDocuments(query),

        ]);

        return {

            users,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),

        };

    }

    async getAllConsultants(filters = {}) {

        const query = {};

        if (filters.search) {

            const searchRegex = { $regex: filters.search, $options: "i" };

            query.$or = [
                { firstName: searchRegex },
                { lastName: searchRegex },
            ];

        }

        if (filters.status) {

            if (filters.status === "active") {

                query.isActive = true;

            } else if (filters.status === "suspended") {

                query.isActive = false;

            }

        }

        const page = parseInt(filters.page) || 1;

        const limit = parseInt(filters.limit) || 10;

        const skip = (page - 1) * limit;

        const [profiles, total] = await Promise.all([

            ConsultantProfile.find(query)
                .populate("userId", "firstName lastName email avatar")
                .populate("categories", "name")
                .sort({ createdAt: -1 })
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

    async getPendingConsultants() {

        const profiles = await ConsultantProfile.find({ approvalStatus: "pending" })
            .populate("userId", "firstName lastName email avatar")
            .populate("categories", "name")
            .sort({ createdAt: -1 });

        return profiles;

    }

    async getAllBookings(filters = {}) {

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

        if (filters.search) {

            const searchRegex = { $regex: filters.search, $options: "i" };

            query.$or = [
                { "clientId.firstName": searchRegex },
                { "clientId.lastName": searchRegex },
                { "clientId.email": searchRegex },
                { "consultantId.firstName": searchRegex },
                { "consultantId.lastName": searchRegex },
                { "consultantId.email": searchRegex },
            ];

        }

        const page = parseInt(filters.page) || 1;

        const limit = parseInt(filters.limit) || 10;

        const skip = (page - 1) * limit;

        const [bookings, total] = await Promise.all([

            Booking.find(query)
                .populate("clientId", "firstName lastName email")
                .populate("consultantId", "firstName lastName email")
                .populate("consultantProfileId", "hourlyRate skills")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),

            Booking.countDocuments(query),

        ]);

        // Convert kobo to Naira for API response
        bookings.forEach(booking => {
            booking.amount = koboToNaira(booking.amount);
        });

        return {

            bookings,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),

        };

    }

    async getReportsData() {

        const sevenMonthsAgo = new Date();
        sevenMonthsAgo.setMonth(sevenMonthsAgo.getMonth() - 7);

        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const [
            revenueTrends,
            topCategories,
            recentTransactions,
            userGrowth,
            totalRevenueResult,
            bookingVolume,
        ] = await Promise.all([

            // Revenue trends: convert kobo to Naira
            Booking.aggregate([
                {
                    $match: {
                        status: "completed",
                        createdAt: { $gte: sevenMonthsAgo },
                    },
                },
                {
                    $group: {
                        _id: {
                            year: { $year: "$createdAt" },
                            month: { $month: "$createdAt" },
                        },
                        revenue: { $sum: "$amount" },
                        bookings: { $sum: 1 },
                    },
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } },
            ]).then(results => results.map(r => ({ ...r, revenue: koboToNaira(r.revenue) }))),

            // Top categories: convert kobo to Naira
            Booking.aggregate([
                { $match: { status: "completed" } },
                {
                    $lookup: {
                        from: "consultantprofiles",
                        localField: "consultantProfileId",
                        foreignField: "_id",
                        as: "profile",
                    },
                },
                { $unwind: "$profile" },
                {
                    $lookup: {
                        from: "categories",
                        localField: "profile.categories",
                        foreignField: "_id",
                        as: "category",
                    },
                },
                { $unwind: "$category" },
                {
                    $group: {
                        _id: "$category.name",
                        revenue: { $sum: "$amount" },
                        bookings: { $sum: 1 },
                    },
                },
                { $sort: { revenue: -1 } },
                { $limit: 5 },
            ]).then(results => results.map(r => ({ ...r, revenue: koboToNaira(r.revenue) }))),

            Booking.find({ status: "completed" })
                .populate("clientId", "firstName lastName email")
                .populate("consultantId", "firstName lastName email")
                .populate("consultantProfileId", "hourlyRate skills")
                .sort({ createdAt: -1 })
                .limit(10),

            User.aggregate([
                {
                    $match: {
                        createdAt: { $gte: sixMonthsAgo },
                    },
                },
                {
                    $group: {
                        _id: {
                            year: { $year: "$createdAt" },
                            month: { $month: "$createdAt" },
                        },
                        users: { $sum: 1 },
                    },
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } },
            ]),

            Booking.aggregate([
                { $match: { status: "completed" } },
                {
                    $group: {
                        _id: null,
                        totalRevenue: { $sum: "$amount" },
                    },
                },
            ]),

            Booking.aggregate([
                {
                    $match: {
                        status: "completed",
                        createdAt: { $gte: sevenMonthsAgo },
                    },
                },
                {
                    $group: {
                        _id: {
                            year: { $year: "$createdAt" },
                            month: { $month: "$createdAt" },
                        },
                        revenue: { $sum: "$amount" },
                        bookings: { $sum: 1 },
                    },
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } },
            ]),

            Booking.aggregate([
                { $match: { status: "completed" } },
                {
                    $lookup: {
                        from: "consultantprofiles",
                        localField: "consultantProfileId",
                        foreignField: "_id",
                        as: "profile",
                    },
                },
                { $unwind: "$profile" },
                {
                    $lookup: {
                        from: "categories",
                        localField: "profile.categories",
                        foreignField: "_id",
                        as: "category",
                    },
                },
                { $unwind: "$category" },
                {
                    $group: {
                        _id: "$category.name",
                        revenue: { $sum: "$amount" },
                        bookings: { $sum: 1 },
                    },
                },
                { $sort: { revenue: -1 } },
                { $limit: 5 },
            ]),

            Booking.find({ status: "completed" })
                .populate("clientId", "firstName lastName email")
                .populate("consultantId", "firstName lastName email")
                .populate("consultantProfileId", "hourlyRate skills")
                .sort({ createdAt: -1 })
                .limit(10),

            User.aggregate([
                {
                    $match: {
                        createdAt: { $gte: sixMonthsAgo },
                    },
                },
                {
                    $group: {
                        _id: {
                            year: { $year: "$createdAt" },
                            month: { $month: "$createdAt" },
                        },
                        users: { $sum: 1 },
                    },
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } },
            ]),

            Booking.aggregate([
                { $match: { status: "completed" } },
                {
                    $group: {
                        _id: null,
                        totalRevenue: { $sum: "$amount" },
                    },
                },
            ]),

            Booking.countDocuments(),

        ]);

        const totalRevenue = koboToNaira(totalRevenueResult.length > 0 ? totalRevenueResult[0].totalRevenue : 0);

        return {

            revenueTrends,
            topCategories,
            recentTransactions,
            userGrowth,
            totalRevenue,
            bookingVolume,

        };

    }

    async getTopPerformers() {

        const topPerformers = await Booking.aggregate([
            {
                $match: {
                    status: "completed",
                },
            },
            {
                $group: {
                    _id: "$consultantId",
                    totalRevenue: { $sum: "$amount" },
                    completedSessions: { $sum: 1 },
                },
            },
            {
                $sort: {
                    totalRevenue: -1,
                    completedSessions: -1,
                },
            },
            {
                $limit: 4,
            },
            {
                $lookup: {
                    from: "users",
                    localField: "_id",
                    foreignField: "_id",
                    as: "consultant",
                },
            },
            {
                $unwind: "$consultant",
            },
            {
                $lookup: {
                    from: "consultantprofiles",
                    localField: "_id",
                    foreignField: "userId",
                    as: "profile",
                },
            },
            {
                $unwind: "$profile",
            },
            {
                $lookup: {
                    from: "categories",
                    localField: "profile.categories",
                    foreignField: "_id",
                    as: "category",
                },
            },
            {
                $unwind: {
                    path: "$category",
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $project: {
                    _id: 1,
                    totalRevenue: 1,
                    completedSessions: 1,
                    firstName: "$consultant.firstName",
                    lastName: "$consultant.lastName",
                    role: "$category.name",
                },
            },
        ]).then(results => results.map(r => ({ ...r, totalRevenue: koboToNaira(r.totalRevenue) })));

        return topPerformers;

    }

    async banUser(userId) {

        return await User.findByIdAndUpdate(
            userId,
            { isActive: false },
            { new: true, runValidators: true }
        ).select("-password");

    }

    async unbanUser(userId) {

        return await User.findByIdAndUpdate(
            userId,
            { isActive: true },
            { new: true, runValidators: true }
        ).select("-password");

    }

    async approveConsultant(profileId) {

        const profile = await ConsultantProfile.findById(profileId);

        if (!profile) {

            return null;

        }

        if (profile.approvalStatus === "approved") {

            throw new Error("Consultant profile is already approved");

        }

        if (profile.approvalStatus === "rejected") {

            throw new Error("Cannot approve a rejected consultant profile. They must resubmit their profile.");

        }

        return await ConsultantProfile.findByIdAndUpdate(
            profileId,
            { approvalStatus: "approved", isActive: true },
            { new: true, runValidators: true }
        );

    }

    async rejectConsultant(profileId) {

        const profile = await ConsultantProfile.findById(profileId);

        if (!profile) {

            return null;

        }

        if (profile.approvalStatus === "rejected") {

            throw new Error("Consultant profile is already rejected");

        }

        if (profile.approvalStatus === "approved") {

            throw new Error("Cannot reject an already approved consultant profile. Use suspend instead.");

        }

        return await ConsultantProfile.findByIdAndUpdate(
            profileId,
            { approvalStatus: "rejected", isActive: false },
            { new: true, runValidators: true }
        );

    }

    async suspendConsultant(profileId) {

        return await ConsultantProfile.findByIdAndUpdate(
            profileId,
            { isActive: false },
            { new: true, runValidators: true }
        );

    }

    async activateConsultant(profileId) {

        return await ConsultantProfile.findByIdAndUpdate(
            profileId,
            { isActive: true },
            { new: true, runValidators: true }
        );

    }

    async changeUserRole(userId, newRole) {

        const validRoles = ["BUSINESS_OWNER", "CONSULTANT", "ADMIN"];

        if (!validRoles.includes(newRole)) {

            throw new Error("Invalid role. Must be one of: " + validRoles.join(", "));

        }

        const user = await User.findByIdAndUpdate(
            userId,
            { role: newRole },
            { new: true, runValidators: true }
        ).select("-password");

        if (!user) {

            return null;

        }

        return user;

    }

}

export default new AdminService();
