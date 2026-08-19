/**
 * Payment Idempotency Tests
 *
 * TC-IDM-01: Re-verifying a successful payment returns the same successful state.
 * TC-IDM-02: Re-verifying a successful payment does not create duplicate bookings.
 * TC-IDM-03: Re-verifying a successful payment does not unnecessarily modify paidAt.
 * TC-IDM-04: Replaying a webhook does not double-settle the payment.
 */

import { jest } from "@jest/globals";
import crypto from "crypto";
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

jest.unstable_mockModule("../services/email/index.js", () => ({
    emailService: {
        send: jest.fn().mockResolvedValue({}),
    },
    paymentSuccessTemplate: jest.fn(() => "<html>Payment Success</html>"),
    paymentFailureTemplate: jest.fn(() => "<html>Payment Failure</html>"),
}));

const paymentService = (await import("../services/payment.service.js")).default;

describe("Payment Idempotency", () => {

    beforeAll(async () => {

        await connectTestDB();

    }, 120000);

    afterAll(async () => {

        await closeTestDB();

    });

    beforeEach(async () => {

        await clearTestDB();

        // Reset mock
        mockAxios.get.mockClear();

    });

    describe("TC-IDM-01: Re-verifying a successful payment returns the same successful state", () => {

        it("should return success: true and alreadyVerified: true when re-verifying an already successful payment", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, {
                amount: 500000,
                paymentStatus: "paid",
                status: "confirmed",
            });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, {
                status: "success",
                paidAt: new Date("2025-01-15T10:00:00Z"),
            });

            // First verification
            const result1 = await paymentService.verifyPayment(payment.reference, "corr-1");

            expect(result1.success).toBe(true);
            expect(result1.alreadyVerified).toBe(true);
            expect(result1.payment.status).toBe("success");

            // Second verification (re-verify)
            const result2 = await paymentService.verifyPayment(payment.reference, "corr-2");

            expect(result2.success).toBe(true);
            expect(result2.alreadyVerified).toBe(true);
            expect(result2.payment.status).toBe("success");

            // Payment state should be unchanged
            const Payment = (await import("../models/Payment.js")).default;
            const refreshedPayment = await Payment.findById(payment._id);

            expect(refreshedPayment.status).toBe("success");
            expect(refreshedPayment.paidAt.getTime()).toBe(payment.paidAt.getTime());

            // Booking state should be unchanged
            const Booking = (await import("../models/Booking.js")).default;
            const refreshedBooking = await Booking.findById(booking._id);

            expect(refreshedBooking.paymentStatus).toBe("paid");
            expect(refreshedBooking.status).toBe("confirmed");

        });

    });

    describe("TC-IDM-02: Re-verifying a successful payment does not create duplicate bookings", () => {

        it("should not create duplicate bookings when re-verifying an already successful payment", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, {
                amount: 500000,
                paymentStatus: "paid",
                status: "confirmed",
            });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, {
                status: "success",
                paidAt: new Date("2025-01-15T10:00:00Z"),
            });

            const Booking = (await import("../models/Booking.js")).default;

            // Count bookings before re-verification
            const bookingCountBefore = await Booking.countDocuments();
            expect(bookingCountBefore).toBe(1);

            // First verification
            const result1 = await paymentService.verifyPayment(payment.reference, "corr-1");
            expect(result1.success).toBe(true);
            expect(result1.alreadyVerified).toBe(true);

            // Count bookings after first re-verification
            const bookingCountAfterFirst = await Booking.countDocuments();
            expect(bookingCountAfterFirst).toBe(1);

            // Second verification (re-verify again)
            const result2 = await paymentService.verifyPayment(payment.reference, "corr-2");
            expect(result2.success).toBe(true);
            expect(result2.alreadyVerified).toBe(true);

            // Count bookings after second re-verification
            const bookingCountAfterSecond = await Booking.countDocuments();
            expect(bookingCountAfterSecond).toBe(1);

            // Verify the original booking is unchanged
            const refreshedBooking = await Booking.findById(booking._id);
            expect(refreshedBooking).toBeDefined();
            expect(refreshedBooking._id.toString()).toBe(booking._id.toString());
            expect(refreshedBooking.paymentStatus).toBe("paid");

            // Verify payment is still success
            const Payment = (await import("../models/Payment.js")).default;
            const refreshedPayment = await Payment.findById(payment._id);
            expect(refreshedPayment.status).toBe("success");

        });

    });

    describe("TC-IDM-03: Re-verifying a successful payment does not unnecessarily modify paidAt", () => {

        it("should keep paidAt exactly unchanged when re-verifying an already successful payment", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const originalPaidAt = new Date("2025-01-15T10:00:00.000Z");

            const booking = await createTestBooking(user._id, consultant._id, {
                amount: 500000,
                paymentStatus: "paid",
                status: "confirmed",
                paidAt: originalPaidAt,
            });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, {
                status: "success",
                paidAt: originalPaidAt,
            });

            // First verification
            const result1 = await paymentService.verifyPayment(payment.reference, "corr-1");
            expect(result1.success).toBe(true);
            expect(result1.alreadyVerified).toBe(true);

            // Re-verify the same successful payment
            const result2 = await paymentService.verifyPayment(payment.reference, "corr-2");
            expect(result2.success).toBe(true);
            expect(result2.alreadyVerified).toBe(true);

            // Verify paidAt is exactly unchanged
            const Payment = (await import("../models/Payment.js")).default;
            const refreshedPayment = await Payment.findById(payment._id);

            expect(refreshedPayment.status).toBe("success");
            expect(refreshedPayment.paidAt.getTime()).toBe(originalPaidAt.getTime());

            // Verify booking paidAt is also unchanged
            const Booking = (await import("../models/Booking.js")).default;
            const refreshedBooking = await Booking.findById(booking._id);

            expect(refreshedBooking.paymentStatus).toBe("paid");
            expect(refreshedBooking.paidAt.getTime()).toBe(originalPaidAt.getTime());

        });

    });

    describe("TC-IDM-04: Replaying a webhook does not double-settle the payment", () => {

        const generateValidSignature = (payload, secret) => {

            return crypto.createHmac("sha512", secret).update(payload).digest("hex");

        };

        it("should handle duplicate webhook events without double-settlement", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            const payload = JSON.stringify({

                event: "charge.success",

                data: { reference: payment.reference },

            });

            const secret = process.env.PAYSTACK_SECRET_KEY || "test-secret";

            const signature = generateValidSignature(payload, secret);

            // Mock axios to return successful verification
            mockAxios.get.mockResolvedValue({

                status: 200,

                data: {

                    status: true,

                    data: {

                        id: 1234567890,

                        status: "success",

                        reference: payment.reference,

                        amount: 500000,

                        currency: "NGN",

                        paid_at: new Date().toISOString(),

                        channel: "card",

                        gateway: "card",

                        fees: 5000,

                        customer: {

                            id: 123,

                            email: "test@example.com",

                        },

                    },

                },

            });

            // Clear email mock call count before first webhook
            const { emailService } = await import("../services/email/index.js");
            emailService.send.mockClear();

            // First webhook - should settle the payment
            const result1 = await paymentService.handleWebhook(payload, signature, "corr-1");

            expect(result1.statusCode).toBe(200);
            expect(result1.body.success).toBe(true);
            expect(result1.body.alreadyVerified).toBe(false);

            // Verify payment is settled
            const Payment = (await import("../models/Payment.js")).default;
            const refreshedPayment = await Payment.findById(payment._id);
            expect(refreshedPayment.status).toBe("success");

            // Verify booking is paid
            const Booking = (await import("../models/Booking.js")).default;
            const refreshedBooking = await Booking.findById(booking._id);
            expect(refreshedBooking.paymentStatus).toBe("paid");

            // Verify only one booking exists
            const bookingCountAfterFirst = await Booking.countDocuments();
            expect(bookingCountAfterFirst).toBe(1);

            // Record email call count after first webhook
            const emailCallCountAfterFirst = emailService.send.mock.calls.length;

            // Second webhook (replay) - should be idempotent
            const result2 = await paymentService.handleWebhook(payload, signature, "corr-2");

            expect(result2.statusCode).toBe(200);
            expect(result2.body.success).toBe(true);
            expect(result2.body.alreadyVerified).toBe(true);

            // Verify payment is still success
            const refreshedPayment2 = await Payment.findById(payment._id);
            expect(refreshedPayment2.status).toBe("success");

            // Verify booking is still paid
            const refreshedBooking2 = await Booking.findById(booking._id);
            expect(refreshedBooking2.paymentStatus).toBe("paid");

            // Verify no duplicate booking was created
            const bookingCountAfterSecond = await Booking.countDocuments();
            expect(bookingCountAfterSecond).toBe(1);

            // Verify settlement side effects (emails) were not unnecessarily repeated
            const emailCallCountAfterSecond = emailService.send.mock.calls.length;
            expect(emailCallCountAfterSecond).toBe(emailCallCountAfterFirst);

        });

    });

});
