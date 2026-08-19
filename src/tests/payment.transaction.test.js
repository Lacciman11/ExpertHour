/**
 * MongoDB Transaction Tests
 *
 * - Verify successful settlement commits Payment + Booking as one atomic operation.
 * - Simulate Payment update succeeds, Booking update fails → Transaction rolls back.
 * - Test successful transaction commit.
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

jest.unstable_mockModule("../services/email/index.js", () => ({

    emailService: {

        send: jest.fn().mockResolvedValue({}),

    },

    paymentSuccessTemplate: jest.fn(() => "<html>Payment Success</html>"),

    paymentFailureTemplate: jest.fn(() => "<html>Payment Failure</html>"),

}));

const paymentService = (await import("../services/payment.service.js")).default;

describe("MongoDB Transaction Tests", () => {

    beforeAll(async () => {

        await connectTestDB();

    });

    afterAll(async () => {

        await closeTestDB();

    });

    beforeEach(async () => {

        await clearTestDB();

        // Reset mock
        mockAxios.get.mockClear();

        // Set up default successful verification response
        mockAxios.get.mockResolvedValue({

            status: 200,

            data: {

                status: true,

                data: {

                    id: 1234567890,

                    status: "success",

                    reference: "EXP-test-reference",

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

    });

    describe("Successful transaction commit", () => {

        it("should commit Payment and Booking updates atomically", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000, status: "pending" });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            // Update mock to use the actual payment reference
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

            const result = await paymentService.reconcilePayment(payment.reference);

            expect(result.success).toBe(true);

            // Verify Payment is success
            const Payment = (await import("../models/Payment.js")).default;

            const updatedPayment = await Payment.findById(payment._id);

            expect(updatedPayment.status).toBe("success");

            // Verify Booking is paid
            const Booking = (await import("../models/Booking.js")).default;

            const updatedBooking = await Booking.findById(booking._id);

            expect(updatedBooking.paymentStatus).toBe("paid");

            // Verify booking status transitioned to confirmed
            expect(updatedBooking.status).toBe("confirmed");

        });

    });

    describe("Transaction rollback on Booking update failure", () => {

        it("should roll back both Payment and Booking when Booking update fails", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000, status: "pending" });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            // Update mock to use the actual payment reference
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

            // We need to simulate a Booking save failure
            // We can do this by mocking the Booking model's save method
            const Booking = (await import("../models/Booking.js")).default;

            const originalSave = Booking.prototype.save;

            let saveCallCount = 0;

            Booking.prototype.save = async function (...args) {

                saveCallCount++;

                // Fail on the first save after mock registration (the one inside the transaction)
                if (saveCallCount === 1) {

                    throw new Error("Simulated Booking save failure");

                }

                return originalSave.apply(this, args);

            };

            try {

                await paymentService.reconcilePayment(payment.reference);

                // If we get here, the test failed - it should have thrown
                expect(true).toBe(false); // Force failure

            } catch (error) {

                // Expected to throw
                expect(error.message).toContain("Database error during settlement");

            }

            // Verify Payment was reverted to pending
            const Payment = (await import("../models/Payment.js")).default;

            const updatedPayment = await Payment.findById(payment._id);

            expect(updatedPayment.status).toBe("pending");

            // Verify Booking was not updated
            const updatedBooking = await Booking.findById(booking._id);

            expect(updatedBooking.paymentStatus).toBe("pending");

            // Restore original save method
            Booking.prototype.save = originalSave;

        });

    });

    describe("Transaction rollback on Payment update failure", () => {

        it("should roll back both Payment and Booking when Payment update fails", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000, status: "pending" });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            // Update mock to use the actual payment reference
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

            // Simulate a Payment save failure inside the transaction
            const Payment = (await import("../models/Payment.js")).default;

            const originalPaymentSave = Payment.prototype.save;

            let paymentSaveCallCount = 0;

            Payment.prototype.save = async function (...args) {

                paymentSaveCallCount++;

                // Fail only on the save inside the transaction (identified by session arg)
                if (args[0] && args[0].session) {

                    throw new Error("Simulated Payment save failure");

                }

                return originalPaymentSave.apply(this, args);

            };

            try {

                await paymentService.reconcilePayment(payment.reference);

                // If we get here, the test failed - it should have thrown
                expect(true).toBe(false); // Force failure

            } catch (error) {

                // Expected to throw
                expect(error.message).toContain("Database error during settlement");

            }

            // Verify Payment was reverted to pending
            const updatedPayment = await Payment.findById(payment._id);

            expect(updatedPayment.status).toBe("pending");

            // Verify Booking was not updated
            const Booking = (await import("../models/Booking.js")).default;

            const updatedBooking = await Booking.findById(booking._id);

            expect(updatedBooking.paymentStatus).toBe("pending");

            // Restore original save method
            Payment.prototype.save = originalPaymentSave;

        });

    });

});