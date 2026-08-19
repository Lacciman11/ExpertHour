/**
 * Test setup for payment service tests.
 *
 * Initializes MongoDB Memory Server and provides utilities for test isolation.
 */

import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let mongod;

/**
 * Connect to in-memory MongoDB before all tests.
 */
export const connectTestDB = async () => {

    mongod = await MongoMemoryReplSet.create({
        instance: {
            replSet: "rs0",
        },
    });

    const uri = mongod.getUri();

    const uriWithRetryWrites = uri.includes("retryWrites=true")
        ? uri.replace("retryWrites=true", "retryWrites=false")
        : uri.includes("?")
            ? `${uri}&retryWrites=false`
            : `${uri}?retryWrites=false`;

    // Increase timeout for replica set connection
    await mongoose.connect(uriWithRetryWrites, {
        retryWrites: false,
        serverSelectionTimeoutMS: 120000,
        socketTimeoutMS: 120000,
    });

    console.log(`[TestSetup] Connected to MongoDB Memory Server at ${uriWithRetryWrites}`);

};

/**
 * Disconnect from MongoDB and stop the memory server after all tests.
 */
export const closeTestDB = async () => {

    if (mongoose.connection.readyState !== 0) {

        await mongoose.disconnect();

        console.log("[TestSetup] Disconnected from MongoDB");

    }

    if (mongod) {

        await mongod.stop();

        console.log("[TestSetup] MongoDB Memory Server stopped");

    }

};

/**
 * Clear all collections in the test database.
 * Use between tests to ensure isolation.
 */
export const clearTestDB = async () => {

    const collections = mongoose.connection.collections;

    for (const key in collections) {

        await collections[key].deleteMany({});

    }

    console.log("[TestSetup] Cleared all collections");

};

/**
 * Create a test user with minimal fields.
 */
export const createTestUser = async (overrides = {}) => {

    const User = (await import("../models/User.js")).default;

    const user = await User.create({

        email: overrides.email || "test@example.com",

        password: overrides.password || "hashedpassword123",

        firstName: overrides.firstName || "Test",

        lastName: overrides.lastName || "User",

        role: overrides.role || "BUSINESS_OWNER",

        isVerified: true,

        ...overrides,

    });

    return user;

};

/**
 * Create a test booking with minimal fields.
 */
export const createTestBooking = async (userId, consultantId, overrides = {}) => {

    const Booking = (await import("../models/Booking.js")).default;

    const booking = await Booking.create({

        clientId: userId,

        consultantId: consultantId,

        consultantProfileId: overrides.consultantProfileId || new mongoose.Types.ObjectId(),

        date: overrides.date || "2025-01-15",

        time: overrides.time || "10:00",

        duration: overrides.duration || 60,

        amount: overrides.amount || 500000, // ₦5,000 in kobo

        status: overrides.status || "pending",

        paymentStatus: overrides.paymentStatus || "pending",

        paymentMethod: overrides.paymentMethod || "paystack",

        ...overrides,

    });

    return booking;

};

/**
 * Create a test payment with minimal fields.
 */
export const createTestPayment = async (bookingId, userId, consultantId, overrides = {}) => {

    const Payment = (await import("../models/Payment.js")).default;

    const reference = overrides.reference || `EXP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const payment = await Payment.create({

        bookingId,

        reference,

        amount: overrides.amount || 500000,

        currency: overrides.currency || "NGN",

        status: overrides.status || "pending",

        paymentMethod: overrides.paymentMethod || "paystack",

        clientId: userId,

        consultantId: consultantId,

        ...overrides,

    });

    return payment;

};

/**
 * Mock Paystack API responses.
 */
export const mockPaystackResponses = () => {

    const mockVerifyResponse = (status = "success") => ({

        status: true,

        message: "Verification successful",

        data: {

            id: 1234567890,

            status,

            reference: "EXP-1234567890-abcdef",

            amount: 500000,

            currency: "NGN",

            paid_at: new Date().toISOString(),

            channel: "card",

            gateway: "card",

            fees: 5000,

            customer: {

                id: 123,

                email: "test@example.com",

                firstName: "Test",

                lastName: "User",

            },

        },

    });

    const mockInitializeResponse = (reference) => ({

        status: true,

        message: "Authorization URL created",

        data: {

            authorization_url: `https://checkout.paystack.com/${reference}`,

            access_code: reference,

            reference,

        },

    });

    return {

        mockVerifyResponse,

        mockInitializeResponse,

    };

};