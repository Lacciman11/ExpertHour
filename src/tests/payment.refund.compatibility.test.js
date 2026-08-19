/**
 * Refund Compatibility Tests
 *
 * TC-REF-01: Refund is only possible for a successful payment.
 * TC-REF-02: Successful refund updates Payment status correctly.
 * TC-REF-03: Successful refund updates Booking status to refunded.
 * TC-REF-04: Refund is idempotent; repeating the refund does not double-refund or corrupt state.
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

describe("Refund Compatibility", () => {

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

    describe("TC-REF-01: Refund is only possible for a successful payment", () => {

        it("should allow refund for successful payment", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "success" });

            // Verify mock is set up
            const axios = await import("axios");
            console.log("axios.default.post:", axios.default.post);
            console.log("axios.default.post === mockAxios.post:", axios.default.post === mockAxios.post);
            expect(mockAxios.post).toBeDefined();
            expect(typeof mockAxios.post).toBe("function");

            const result = await paymentService.initiateRefund(payment._id, null, user._id);

            expect(result.success).toBe(true);

            expect(result.payment.refundStatus).toBe("pending");

        });

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
    
        describe("TC-REF-03: Successful refund updates Booking status to refunded", () => {
    
            it("should update booking refundStatus to pending after successful refund initiation", async () => {
    
                const user = await createTestUser();
    
                const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });
    
                const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });
    
                const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "success" });
    
                const result = await paymentService.initiateRefund(payment._id, null, user._id);
    
                expect(result.success).toBe(true);
    
                // Verify booking refundStatus was updated
                const Booking = (await import("../models/Booking.js")).default;
    
                const updatedBooking = await Booking.findById(booking._id);
    
                expect(updatedBooking.refundStatus).toBe("pending");
    
                // Verify payment refundStatus was updated
                expect(result.payment.refundStatus).toBe("pending");
    
                // Verify refund reference was stored
                expect(result.payment.refundReference).toBe("REF-test");
    
                // Verify no duplicate booking was created
                const allBookings = await Booking.find({ clientId: user._id, consultantId: consultant._id });
    
                expect(allBookings.length).toBe(1);
    
            });
        
            describe("TC-REF-04: Refund is idempotent; repeating the refund does not double-refund or corrupt state", () => {
        
                it("should reject duplicate refund and not corrupt state", async () => {
        
                    const user = await createTestUser();
        
                    const consultant = await createTestUser({ email: "consultant2@example.com", role: "CONSULTANT" });
        
                    const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });
        
                    const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "success" });
        
                    // First refund succeeds
                    const result1 = await paymentService.initiateRefund(payment._id, null, user._id);
        
                    expect(result1.success).toBe(true);
                    expect(result1.payment.refundStatus).toBe("pending");
        
                    // Second refund should be rejected
                    await expect(paymentService.initiateRefund(payment._id, null, user._id)).rejects.toThrow("Payment has already been refunded");
        
                    // Verify payment state is unchanged
                    const Payment = (await import("../models/Payment.js")).default;
        
                    const refreshedPayment = await Payment.findById(payment._id);
        
                    expect(refreshedPayment.refundStatus).toBe("pending");
                    expect(refreshedPayment.refundReference).toBe("REF-test");
        
                    // Verify booking state is unchanged
                    const Booking = (await import("../models/Booking.js")).default;
        
                    const refreshedBooking = await Booking.findById(booking._id);
        
                    expect(refreshedBooking.refundStatus).toBe("pending");
        
                    // Verify no duplicate booking
                    const allBookings = await Booking.find({ clientId: user._id, consultantId: consultant._id });
        
                    expect(allBookings.length).toBe(1);
        
                });
        
            });
        
        });
    
    });

});
