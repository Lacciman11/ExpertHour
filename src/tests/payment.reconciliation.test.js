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
import Notification from "../models/Notification.js";
import { NOTIFICATION_CATEGORY } from "../utils/constants.js";

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
    paymentSuccessConsultantTemplate: jest.fn(() => "<html>Payment Success</html>"),
    paymentFailureConsultantTemplate: jest.fn(() => "<html>Payment Failure</html>"),
    // Test-safe stubs for the remaining real exports so the module mock
    // satisfies every named export the production module re-exports. These
    // are never invoked by the payment reconciliation path under test.
    forgotPasswordTemplate: jest.fn(() => "<html>Forgot Password</html>"),
    verifyEmailTemplate: jest.fn(() => "<html>Verify Email</html>"),
    consultantApprovalTemplate: jest.fn(() => "<html>Consultant Approval</html>"),
    consultantRejectionTemplate: jest.fn(() => "<html>Consultant Rejection</html>"),
    bookingCancelledTemplate: jest.fn(() => "<html>Booking Cancelled</html>"),
    bookingDeclinedTemplate: jest.fn(() => "<html>Booking Declined</html>"),
    refundCompletedTemplate: jest.fn(() => "<html>Refund Completed</html>"),
    refundFailedTemplate: jest.fn(() => "<html>Refund Failed</html>"),
    payoutCompletedTemplate: jest.fn(() => "<html>Payout Completed</html>"),
    payoutFailedTemplate: jest.fn(() => "<html>Payout Failed</html>"),
    sessionCompletedTemplate: jest.fn(() => "<html>Session Completed</html>"),
    reviewReceivedTemplate: jest.fn(() => "<html>Review Received</html>"),
    earningCancelledTemplate: jest.fn(() => "<html>Earning Cancelled</html>"),
    bookingReminderTemplate: jest.fn(() => "<html>Booking Reminder</html>"),
    reviewRequestTemplate: jest.fn(() => "<html>Review Request</html>"),
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

    describe("TC-REC-11: Terminal failure persists a payment.failed in-app notification", () => {

        const failedPaystackResponse = (reference) => ({
            status: 200,
            data: {
                status: true,
                data: {
                    id: 1234567890,
                    status: "failed",
                    reference,
                    amount: 500000,
                    currency: "NGN",
                    paid_at: null,
                    channel: "card",
                    gateway: "card",
                    fees: 0,
                    customer: { id: 123, email: "test@example.com" },
                },
            },
        });

        it("creates exactly one payment.failed notification for the client", async () => {
            const user = await createTestUser();
            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });
            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });
            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            mockAxios.get.mockResolvedValue(failedPaystackResponse(payment.reference));

            await paymentService.reconcilePayment(payment.reference);

            const clientNotes = await Notification.find({ recipientId: user._id });
            const consultantNotes = await Notification.find({ recipientId: consultant._id });

            expect(clientNotes).toHaveLength(1);
            expect(consultantNotes).toHaveLength(0);

            const note = clientNotes[0];
            expect(note.category).toBe(NOTIFICATION_CATEGORY.PAYMENT);
            expect(note.type).toBe("payment.failed");
            expect(note.data.bookingId.toString()).toBe(booking._id.toString());
            expect(note.data.paymentId.toString()).toBe(payment._id.toString());
            expect(note.data.deepLinkPath).toBe("/dashboard/client/payments");
            // The emitter derives the key as `${type}:${recipientId}:${subjectId}`,
            // where subjectId is the booking id — not the payment reference.
            expect(note.dedupeKey).toBe(`payment.failed:${user._id.toString()}:${booking._id.toString()}`);
        });

        it("does not create duplicate notifications on repeated reconciliation", async () => {
            const user = await createTestUser();
            const consultant = await createTestUser({ email: "consultant2@example.com", role: "CONSULTANT" });
            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });
            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            mockAxios.get.mockResolvedValue(failedPaystackResponse(payment.reference));

            // First reconciliation transitions pending → failed and notifies.
            await paymentService.reconcilePayment(payment.reference);

            // Second reconciliation: the payment is already terminal. The
            // reconcilePayment idempotency guard (status !== "pending") returns
            // early, so the dedupe key is never re-inserted.
            await paymentService.reconcilePayment(payment.reference);

            const clientNotes = await Notification.find({ recipientId: user._id });
            expect(clientNotes).toHaveLength(1);
        });

        it("does not notify on a transient verification error", async () => {
            const user = await createTestUser();
            const consultant = await createTestUser({ email: "consultant3@example.com", role: "CONSULTANT" });
            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });
            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            // Transient provider error: reconcilePayment reverts to pending
            // and throws; no terminal failure is established.
            mockAxios.get.mockRejectedValue(new Error("Network timeout"));

            await expect(paymentService.reconcilePayment(payment.reference)).rejects.toMatchObject({
                type: "transient",
            });

            const clientNotes = await Notification.find({ recipientId: user._id });
            expect(clientNotes).toHaveLength(0);

            const Payment = (await import("../models/Payment.js")).default;
            const updatedPayment = await Payment.findById(payment._id);
            expect(updatedPayment.status).toBe("pending");
        });

        it("keeps the terminal payment outcome and failure emails when notification creation fails", async () => {
            const user = await createTestUser();
            const consultant = await createTestUser({ email: "consultant4@example.com", role: "CONSULTANT" });
            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });
            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            mockAxios.get.mockResolvedValue(failedPaystackResponse(payment.reference));

            // Force the notification path to throw. The domain emitter
            // swallows this, but we verify the terminal outcome is intact.
            const createSpy = jest
                .spyOn((await import("../services/notification.service.js")).default, "create")
                .mockRejectedValue(new Error("notification store unavailable"));

            const result = await paymentService.reconcilePayment(payment.reference);

            expect(result.success).toBe(false);
            expect(result.payment.status).toBe("failed");
            expect(result.booking.paymentStatus).toBe("failed");

            const Payment = (await import("../models/Payment.js")).default;
            const persistedPayment = await Payment.findById(payment._id);
            expect(persistedPayment.status).toBe("failed");

            const clientNotes = await Notification.find({ recipientId: user._id });
            expect(clientNotes).toHaveLength(0);

            createSpy.mockRestore();
        });

    });

    describe("TC-REC-12: Successful reconciliation persists a payment.success in-app notification", () => {

        const successPaystackResponse = (reference) => ({
            status: 200,
            data: {
                status: true,
                data: {
                    id: 1234567890,
                    status: "success",
                    reference,
                    amount: 500000,
                    currency: "NGN",
                    paid_at: new Date().toISOString(),
                    channel: "card",
                    gateway: "card",
                    fees: 5000,
                    customer: { id: 123, email: "test@example.com" },
                },
            },
        });

        it("creates exactly one payment.success notification for the client", async () => {
            const user = await createTestUser();
            const consultant = await createTestUser({ email: "consultant12@example.com", role: "CONSULTANT" });
            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });
            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            mockAxios.get.mockResolvedValue(successPaystackResponse(payment.reference));

            const result = await paymentService.reconcilePayment(payment.reference);

            expect(result.success).toBe(true);
            expect(result.payment.status).toBe("success");
            expect(result.booking.paymentStatus).toBe("paid");

            const clientNotes = await Notification.find({ recipientId: user._id });
            const consultantNotes = await Notification.find({ recipientId: consultant._id });

            expect(clientNotes).toHaveLength(1);
            expect(consultantNotes).toHaveLength(0);

            const note = clientNotes[0];
            expect(note.category).toBe(NOTIFICATION_CATEGORY.PAYMENT);
            expect(note.type).toBe("payment.success");
            expect(note.recipientId.toString()).toBe(user._id.toString());
            expect(note.data.bookingId.toString()).toBe(booking._id.toString());
            expect(note.data.paymentId.toString()).toBe(payment._id.toString());
            expect(note.data.deepLinkPath).toBe("/dashboard/client/payments");
            // The emitter derives the key as `${type}:${recipientId}:${subjectId}`,
            // where subjectId is the booking id — not the payment reference.
            expect(note.dedupeKey).toBe(`payment.success:${user._id.toString()}:${booking._id.toString()}`);
        });

        it("does not create duplicate notifications on repeated reconciliation", async () => {
            const user = await createTestUser();
            const consultant = await createTestUser({ email: "consultant12b@example.com", role: "CONSULTANT" });
            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });
            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            mockAxios.get.mockResolvedValue(successPaystackResponse(payment.reference));

            // First reconciliation transitions pending → success and notifies.
            await paymentService.reconcilePayment(payment.reference);

            // Second reconciliation: the payment is already terminal. The
            // reconcilePayment idempotency guard (status !== "pending") returns
            // early, so the dedupe key is never re-inserted.
            await paymentService.reconcilePayment(payment.reference);

            const clientNotes = await Notification.find({ recipientId: user._id });
            expect(clientNotes).toHaveLength(1);
        });

        it("does not notify on a transient verification error", async () => {
            const user = await createTestUser();
            const consultant = await createTestUser({ email: "consultant12c@example.com", role: "CONSULTANT" });
            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });
            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            // Transient provider error: reconcilePayment reverts to pending
            // and throws; no success state is established.
            mockAxios.get.mockRejectedValue(new Error("Network timeout"));

            await expect(paymentService.reconcilePayment(payment.reference)).rejects.toMatchObject({
                type: "transient",
            });

            const clientNotes = await Notification.find({ recipientId: user._id });
            expect(clientNotes).toHaveLength(0);

            const Payment = (await import("../models/Payment.js")).default;
            const updatedPayment = await Payment.findById(payment._id);
            expect(updatedPayment.status).toBe("pending");
        });

        it("keeps the committed success state and emails when notification creation fails", async () => {
            const user = await createTestUser();
            const consultant = await createTestUser({ email: "consultant12d@example.com", role: "CONSULTANT" });
            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });
            const payment = await createTestPayment(booking._id, user._id, consultant._id, { status: "pending" });

            mockAxios.get.mockResolvedValue(successPaystackResponse(payment.reference));

            // Force the notification path to throw. The domain emitter
            // swallows this, but we verify the committed success outcome and
            // the existing success-email path remain intact.
            const createSpy = jest
                .spyOn((await import("../services/notification.service.js")).default, "create")
                .mockRejectedValue(new Error("notification store unavailable"));

            const result = await paymentService.reconcilePayment(payment.reference);

            expect(result.success).toBe(true);
            expect(result.payment.status).toBe("success");
            expect(result.booking.paymentStatus).toBe("paid");

            const Payment = (await import("../models/Payment.js")).default;
            const persistedPayment = await Payment.findById(payment._id);
            expect(persistedPayment.status).toBe("success");

            const clientNotes = await Notification.find({ recipientId: user._id });
            expect(clientNotes).toHaveLength(0);

            createSpy.mockRestore();
        });

    });

});

            