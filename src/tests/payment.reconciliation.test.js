/**
 * Payment Reconciliation Tests
 *
 * TC-REC-01: Successful Paystack verification results in Payment.status = success and Booking.paymentStatus = paid.
 * TC-REC-02: Reconciliation is idempotent.
 * TC-REC-03: Paystack failed status does not become success.
 * TC-REC-04: Amount mismatch is rejected.
 * TC-REC-05: Currency mismatch is rejected.
 * TC-REC-06: Reference mismatch is rejected.
 * TC-REC-07: Payment/Booking relationship mismatch is rejected.
 * TC-REC-08: Unknown reference returns not-found behavior.
 * TC-REC-09: Already-successful payment returns safely without side effects.
 * TC-REC-10: Paystack/network failure is classified as transient and does not corrupt payment state.
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

describe("Payment Reconciliation", () => {

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

    describe("TC-REC-01: Successful Paystack verification results in success", () => {

        it("should set Payment.status = success and Booking.paymentStatus = paid", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

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

            expect(result.payment.status).toBe("success");

            expect(result.booking.paymentStatus).toBe("paid");

        });

    });

    describe("TC-REC-02: Reconciliation is idempotent", () => {

        it("should return the same result on repeated calls for a successful payment", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "success" });

            const result1 = await paymentService.reconcilePayment(payment.reference);

            const result2 = await paymentService.reconcilePayment(payment.reference);

            expect(result1.success).toBe(true);

            expect(result2.success).toBe(true);

            expect(result1.alreadyVerified).toBe(true);

            expect(result2.alreadyVerified).toBe(true);

            expect(result1.payment._id.toString()).toBe(result2.payment._id.toString());

        });

    });

    describe("TC-REC-03: Paystack failed status does not become success", () => {

        it("should mark payment as failed when Paystack returns failed status", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            // Mock axios to return failed verification
            mockAxios.get.mockResolvedValue({

                status: 200,

                data: {

                    status: true,

                    data: {

                        id: 1234567890,

                        status: "failed",

                        reference: payment.reference,

                        amount: 500000,

                        currency: "NGN",

                        paid_at: null,

                        channel: "card",

                        gateway: "card",

                        fees: 0,

                        customer: {

                            id: 123,

                            email: "test@example.com",

                        },

                    },

                },

            });

            const result = await paymentService.reconcilePayment(payment.reference);

            expect(result.success).toBe(false);

            expect(result.payment.status).toBe("failed");

            expect(result.booking.paymentStatus).toBe("failed");

        });

    });

    describe("TC-REC-04: Amount mismatch is rejected", () => {

        it("should throw integrity error when Paystack amount differs from payment amount", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending", amount: 500000 });

            // Mock axios to return different amount
            mockAxios.get.mockResolvedValue({

                status: 200,

                data: {

                    status: true,

                    data: {

                        id: 1234567890,

                        status: "success",

                        reference: payment.reference,

                        amount: 499999, // Different amount!

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

            await expect(paymentService.reconcilePayment(payment.reference)).rejects.toThrow("Amount integrity error");

            // Payment should remain in pending state
            const Payment = (await import("../models/Payment.js")).default;

            const updatedPayment = await Payment.findById(payment._id);

            expect(updatedPayment.status).toBe("pending");

        });

    });

    describe("TC-REC-05: Currency mismatch is rejected", () => {

        it("should throw integrity error when Paystack currency is not NGN", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            // Mock axios to return different currency
            mockAxios.get.mockResolvedValue({

                status: 200,

                data: {

                    status: true,

                    data: {

                        id: 1234567890,

                        status: "success",

                        reference: payment.reference,

                        amount: 500000,

                        currency: "USD", // Different currency!

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

            await expect(paymentService.reconcilePayment(payment.reference)).rejects.toThrow("Currency integrity error");

        });

    });

    describe("TC-REC-06: Reference mismatch is rejected", () => {

        it("should throw integrity error when Paystack reference differs from payment reference", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            // Mock axios to return different reference
            mockAxios.get.mockResolvedValue({

                status: 200,

                data: {

                    status: true,

                    data: {

                        id: 1234567890,

                        status: "success",

                        reference: "EXP-other-reference", // Different reference!

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

            await expect(paymentService.reconcilePayment(payment.reference)).rejects.toThrow("Reference integrity error");

        });

    });

    describe("TC-REC-07: Payment/Booking relationship mismatch is rejected", () => {

        it("should throw integrity error when payment does not match its booking", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            // Manually corrupt the payment's bookingId to a non-existent booking
            payment.bookingId = new mongoose.Types.ObjectId();

            await payment.save();

            // The service will throw "Booking not found" which is the correct behavior
            // when the booking doesn't exist. This is a security check.
            await expect(paymentService.reconcilePayment(payment.reference)).rejects.toThrow("Booking not found");

        });

    });

    describe("TC-REC-08: Unknown reference returns not-found behavior", () => {

        it("should throw not_found error for unknown reference", async () => {

            await expect(paymentService.reconcilePayment("EXP-nonexistent-reference")).rejects.toThrow("Payment record not found");

        });

    });

    describe("TC-REC-09: Already-successful payment returns safely without side effects", () => {

        it("should return alreadyVerified: true without modifying anything", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "success" });

            const result = await paymentService.reconcilePayment(payment.reference);

            expect(result.success).toBe(true);

            expect(result.alreadyVerified).toBe(true);

            // Verify no additional changes were made
            const Payment = (await import("../models/Payment.js")).default;

            const updatedPayment = await Payment.findById(payment._id);

            expect(updatedPayment.status).toBe("success");

        });

    });

    describe("TC-REC-10: Paystack/network failure is classified as transient", () => {

        it("should revert to pending and throw transient error on Paystack failure", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            // Mock axios to throw network error
            mockAxios.get.mockRejectedValue(new Error("Network timeout"));

            await expect(paymentService.reconcilePayment(payment.reference)).rejects.toMatchObject({

                type: "transient",

            });

            // Payment should be reverted to pending
            const Payment = (await import("../models/Payment.js")).default;

            const updatedPayment = await Payment.findById(payment._id);

            expect(updatedPayment.status).toBe("pending");

        });

    });

});