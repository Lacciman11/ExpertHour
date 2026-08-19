/**
 * Polling / Recovery Tests
 *
 * - Pending payments are discovered after configured delay
 * - Successful payments are skipped
 * - Failed payments are skipped
 * - Abandoned payments are skipped
 * - Stale processing payments are detected
 * - Max reconciliation attempts are respected
 * - Batch size is respected
 * - Worker does not overlap itself
 * - Worker shuts down cleanly
 */

import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { connectTestDB, closeTestDB, clearTestDB, createTestUser, createTestBooking, createTestPayment } from "./setup.js";
import paymentReconciliationService from "../services/payment-reconciliation.service.js";
import env from "../config/env.js";

describe("Payment Polling / Recovery Tests", () => {

    beforeAll(async () => {

        await connectTestDB();

    });

    afterAll(async () => {

        await closeTestDB();

    });

    beforeEach(async () => {

        await clearTestDB();

        // Reset service state
        paymentReconciliationService.isRunning = false;

        paymentReconciliationService.shutdownRequested = false;

        paymentReconciliationService.timerId = null;

    });

    describe("Pending payments discovery", () => {

        it("should discover pending payments after configured delay", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            // Create a payment that is old enough to be eligible for reconciliation
            const oldDate = new Date(Date.now() - (env.paymentReconciliation.delayMs + 1000));

            const payment = await createTestPayment(booking._id, user._id, consultant._id, {

                status: "pending",

                createdAt: oldDate,

                reconciliationAttempts: 0,

            });

            const candidates = await paymentReconciliationService._findCandidates();

            expect(candidates.length).toBeGreaterThanOrEqual(1);

            expect(candidates.some(c => c.reference === payment.reference)).toBe(true);

        });

    });

    describe("Successful payments are skipped", () => {

        it("should not include successful payments in candidates", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            await createTestPayment(booking._id, user._id, consultant._id, { status: "success" });

            const candidates = await paymentReconciliationService._findCandidates();

            expect(candidates.length).toBe(0);

        });

    });

    describe("Failed payments are skipped", () => {

        it("should not include failed payments in candidates", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            await createTestPayment(booking._id, user._id, consultant._id, { status: "failed" });

            const candidates = await paymentReconciliationService._findCandidates();

            expect(candidates.length).toBe(0);

        });

    });

    describe("Abandoned payments are skipped", () => {

        it("should not include abandoned payments in candidates", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            await createTestPayment(booking._id, user._id, consultant._id, { status: "abandoned" });

            const candidates = await paymentReconciliationService._findCandidates();

            expect(candidates.length).toBe(0);

        });

    });

    describe("Stale processing payments are detected", () => {

        it("should include stale processing payments in candidates", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            // Create a processing payment that is older than the timeout
            const oldDate = new Date(Date.now() - (env.paymentReconciliation.processingTimeoutMs + 1000));

            const payment = await createTestPayment(booking._id, user._id, consultant._id, {

                status: "processing",

                processingStartedAt: oldDate,

                reconciliationAttempts: 0,

            });

            const candidates = await paymentReconciliationService._findCandidates();

            expect(candidates.length).toBeGreaterThanOrEqual(1);

            expect(candidates.some(c => c.reference === payment.reference)).toBe(true);

        });

    });

    describe("Max reconciliation attempts are respected", () => {

        it("should not include payments that have exceeded max attempts", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

            const oldDate = new Date(Date.now() - (env.paymentReconciliation.delayMs + 1000));

            await createTestPayment(booking._id, user._id, consultant._id, {

                status: "pending",

                createdAt: oldDate,

                reconciliationAttempts: env.paymentReconciliation.maxAttempts,

            });

            const candidates = await paymentReconciliationService._findCandidates();

            expect(candidates.length).toBe(0);

        });

    });

    describe("Batch size is respected", () => {

        it("should not return more candidates than batch size", async () => {

            const user = await createTestUser();

            const consultant = await createTestUser({ email: "consultant@example.com", role: "CONSULTANT" });

            const oldDate = new Date(Date.now() - (env.paymentReconciliation.delayMs + 1000));

            // Create more payments than batch size
            for (let i = 0; i < env.paymentReconciliation.batchSize + 5; i++) {

                const booking = await createTestBooking(user._id, consultant._id, { amount: 500000 });

                await createTestPayment(booking._id, user._id, consultant._id, {

                    status: "pending",

                    createdAt: oldDate,

                    reconciliationAttempts: 0,

                });

            }

            const candidates = await paymentReconciliationService._findCandidates();

            expect(candidates.length).toBeLessThanOrEqual(env.paymentReconciliation.batchSize);

        });

    });

    describe("Worker does not overlap itself", () => {

        it("should not start a new cycle if one is already running", async () => {

            // Set the service as running
            paymentReconciliationService.isRunning = true;

            // Try to start again
            paymentReconciliationService.start();

            // Should not start a new cycle
            expect(paymentReconciliationService.timerId).toBeNull();

        });

    });

    describe("Worker shuts down cleanly", () => {

        it("should stop the worker and clear the timer", async () => {

            // Start the worker
            paymentReconciliationService.start();

            // Request shutdown
            paymentReconciliationService.stop();

            expect(paymentReconciliationService.shutdownRequested).toBe(true);

            expect(paymentReconciliationService.timerId).toBeNull();

        });

    });

});