/**
 * Refund Tests
 *
 * 1. Refund only succeeds for successful payments.
 * 2. Payment is updated correctly.
 * 3. Booking becomes refunded.
 * 4. Repeated refund attempt is handled safely/idempotently.
 */

import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { connectTestDB, closeTestDB, clearTestDB, createTestUser, createTestBooking, createTestPayment } from "./setup.js";

const mockAxios = {
    get: jest.fn(),
    post: jest.fn(),
    request: jest.fn(),
};

jest.unstable_mockModule("axios", () => ({
    default: mockAxios,
}));

const paymentService = (await import("../services/payment.service.js")).default;

// Set up default successful refund response at top level
mockAxios.post.mockResolvedValue({

    status: 200,

    data: {

        status: true,

        message: "Refund initiated",

        data: {

            id: 987654321,

            status: "pending",

            reference: "REF-test",

            amount: 500000,

            currency: "NGN",

            transaction: "EXP-test-reference",

        },

    },

});

describe("Payment Refund Tests", () => {

    beforeAll(async () => {

        await connectTestDB();

    });

    afterAll(async () => {

        await closeTestDB();

    });

    beforeEach(async () => {

        await clearTestDB();

        // Reset mock
        mockAxios.post.mockClear();

    });

    describe("Refund only succeeds for successful payments", () => {

        it("should allow refund for successful payment", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "success" });

            const result = await paymentService.initiateRefund(payment._id, null, user._id);

            expect(result.success).toBe(true);

            expect(result.payment.refundStatus).toBe("pending");

        });

    });

    describe("Refund fails for non-successful payments", () => {

        it("should reject refund for pending payment", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            await expect(paymentService.initiateRefund(payment._id, null, user._id)).rejects.toThrow("Cannot refund a payment that is not successful");

        });

        it("should reject refund for failed payment", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "failed" });

            await expect(paymentService.initiateRefund(payment._id, null, user._id)).rejects.toThrow("Cannot refund a payment that is not successful");

        });

    });

    describe("Payment is updated correctly", () => {

        it("should update payment refund fields after successful refund initiation", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "success" });

            const refundReference = "REF-test";

            // Mock axios to return successful refund
            mockAxios.post.mockResolvedValue({

                status: 200,

                data: {

                    status: true,

                    message: "Refund initiated",

                    data: {

                        id: 987654321,

                        status: "pending",

                        reference: refundReference,

                        amount: 500000,

                        currency: "NGN",

                        transaction: payment.reference,

                    },

                },

            });

            const result = await paymentService.initiateRefund(payment._id, null, user._id);

            expect(result.payment.refundStatus).toBe("pending");

            expect(result.payment.refundAmount).toBe(5000);

            expect(result.payment.refundReference).toBe(refundReference);

        });

    });

    describe("Booking becomes refunded", () => {

        it("should update booking refund status after refund initiation", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "success" });

            // Mock axios to return successful refund
            mockAxios.post.mockResolvedValue({

                status: 200,

                data: {

                    status: true,

                    message: "Refund initiated",

                    data: {

                        id: 987654321,

                        status: "pending",

                        reference: "REF-test",

                        amount: 500000,

                        currency: "NGN",

                        transaction: payment.reference,

                    },

                },

            });

            await paymentService.initiateRefund(payment._id, null, user._id);

            // Verify booking was updated
            const Booking = (await import("../models/Booking.js")).default;

            const updatedBooking = await Booking.findById(booking._id);

            expect(updatedBooking.refundStatus).toBe("pending");

        });

    });

    describe("Repeated refund attempt is handled safely", () => {

        it("should reject duplicate refund for already refunded payment", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, {

                status: "success",

                refundStatus: "completed",

            });

            await expect(paymentService.initiateRefund(payment._id, null, user._id)).rejects.toThrow("Payment has already been refunded");

        });

    });

});