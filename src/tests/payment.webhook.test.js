/**
 * Webhook Tests
 *
 * TC-WHB-01: Valid signature + successful transaction → HTTP 200.
 * TC-WHB-02: Invalid signature → HTTP 400.
 * TC-WHB-03: Missing signature → HTTP 400.
 * TC-WHB-04: Amount mismatch → HTTP 400.
 * TC-WHB-05: Unknown reference → HTTP 404.
 * TC-WHB-06: Transient Paystack failure → HTTP 500.
 * TC-WHB-07: Paystack webhook signature verification.
 * TC-WHB-08: Duplicate webhook event is idempotent.
 * TC-WHB-09: Fake webhook with invalid signature cannot settle a payment.
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

describe("Payment Webhook Tests", () => {

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

    const generateValidSignature = (payload, secret) => {

        return crypto.createHmac("sha512", secret).update(payload).digest("hex");

    };

    describe("TC-WHB-01: Valid signature + successful transaction → HTTP 200", () => {

        it("should return 200 for valid webhook with successful transaction", async () => {

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

            const result = await paymentService.handleWebhook(payload, signature, "test-correlation-id");

            expect(result.statusCode).toBe(200);

            expect(result.body.success).toBe(true);

        });

    });

    describe("TC-WHB-02: Invalid signature → HTTP 400", () => {

        it("should return 400 for invalid webhook signature", async () => {

            const payload = JSON.stringify({

                event: "charge.success",

                data: { reference: "EXP-test" },

            });

            const invalidSignature = "invalid-signature";

            await expect(paymentService.handleWebhook(payload, invalidSignature, "test-correlation-id")).rejects.toThrow("Invalid webhook signature");

        });

    });

    describe("TC-WHB-03: Missing signature → HTTP 400", () => {

        it("should return 400 when signature is missing", async () => {

            // This is handled in the controller, not the service
            // The service expects a signature parameter
            const payload = JSON.stringify({

                event: "charge.success",

                data: { reference: "EXP-test" },

            });

            // Empty signature should be treated as invalid
            await expect(paymentService.handleWebhook(payload, "", "test-correlation-id")).rejects.toThrow("Invalid webhook signature");

        });

    });

    describe("TC-WHB-04: Amount mismatch → HTTP 400", () => {

        it("should return 400 when webhook amount does not match payment amount", async () => {

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

            const result = await paymentService.handleWebhook(payload, signature, "test-correlation-id");

            expect(result.statusCode).toBe(400);

            expect(result.body.success).toBe(false);

        });

    });

    describe("TC-WHB-05: Unknown reference → HTTP 404", () => {

        it("should return 404 for unknown payment reference", async () => {

            const payload = JSON.stringify({

                event: "charge.success",

                data: { reference: "EXP-nonexistent" },

            });

            const secret = process.env.PAYSTACK_SECRET_KEY || "test-secret";

            const signature = generateValidSignature(payload, secret);

            // Mock axios to return successful verification for unknown reference
            mockAxios.get.mockResolvedValue({

                status: 200,

                data: {

                    status: true,

                    data: {

                        id: 1234567890,

                        status: "success",

                        reference: "EXP-nonexistent",

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

            const result = await paymentService.handleWebhook(payload, signature, "test-correlation-id");

            expect(result.statusCode).toBe(404);

            expect(result.body.success).toBe(false);

        });

    });

    describe("TC-WHB-06: Transient Paystack failure → HTTP 500", () => {

        it("should return 500 for transient Paystack failure", async () => {

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

            // Mock axios to throw network error
            mockAxios.get.mockRejectedValue(new Error("Network timeout"));

            const result = await paymentService.handleWebhook(payload, signature, "test-correlation-id");

            expect(result.statusCode).toBe(500);

            expect(result.body.success).toBe(false);

        });

    });

    describe("TC-WHB-07: Paystack webhook signature verification", () => {

        it("A. should accept valid Paystack signature and settle payment", async () => {

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

            const result = await paymentService.handleWebhook(payload, signature, "test-correlation-id");

            expect(result.statusCode).toBe(200);

            expect(result.body.success).toBe(true);

            // Payment should be settled
            const Payment = (await import("../models/Payment.js")).default;

            const updatedPayment = await Payment.findById(payment._id);

            expect(updatedPayment.status).toBe("success");

        });

        it("B. should reject invalid signature and not settle payment", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            const payload = JSON.stringify({

                event: "charge.success",

                data: { reference: payment.reference },

            });

            const invalidSignature = "invalid-signature";

            // Signature verification fails before axios is called
            await expect(paymentService.handleWebhook(payload, invalidSignature, "test-correlation-id")).rejects.toThrow("Invalid webhook signature");

            // Payment must remain unsettled
            const Payment = (await import("../models/Payment.js")).default;

            const updatedPayment = await Payment.findById(payment._id);

            expect(updatedPayment.status).toBe("pending");

        });

        it("C. should reject missing signature and not settle payment", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            const payload = JSON.stringify({

                event: "charge.success",

                data: { reference: payment.reference },

            });

            // Empty signature should be treated as invalid
            await expect(paymentService.handleWebhook(payload, "", "test-correlation-id")).rejects.toThrow("Invalid webhook signature");

            // Payment must remain unsettled
            const Payment = (await import("../models/Payment.js")).default;

            const updatedPayment = await Payment.findById(payment._id);

            expect(updatedPayment.status).toBe("pending");

        });

    });

    describe("TC-WHB-08: Duplicate webhook event is idempotent", () => {

        it("should handle duplicate webhook events without duplicate settlement", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "success" });

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

            // Send the same webhook twice
            const result1 = await paymentService.handleWebhook(payload, signature, "test-correlation-id-1");

            const result2 = await paymentService.handleWebhook(payload, signature, "test-correlation-id-2");

            // Both should return 200 with alreadyVerified: true
            expect(result1.statusCode).toBe(200);

            expect(result2.statusCode).toBe(200);

            expect(result1.body.alreadyVerified).toBe(true);

            expect(result2.body.alreadyVerified).toBe(true);

        });

    });

    describe("TC-WHB-09: Fake webhook with invalid signature cannot settle a payment", () => {

        it("should reject webhook with invalid signature even for valid-looking payload", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            const payload = JSON.stringify({

                event: "charge.success",

                data: { reference: payment.reference },

            });

            // Use a completely invalid signature
            const invalidSignature = "0".repeat(128);

            await expect(paymentService.handleWebhook(payload, invalidSignature, "test-correlation-id")).rejects.toThrow("Invalid webhook signature");

            // Payment should remain in pending state
            const Payment = (await import("../models/Payment.js")).default;

            const updatedPayment = await Payment.findById(payment._id);

            expect(updatedPayment.status).toBe("pending");

        });

    });

});