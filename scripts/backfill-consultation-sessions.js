import mongoose from "mongoose";
import dotenv from "dotenv";

import Booking from "../src/models/Booking.js";
import Payment from "../src/models/Payment.js";
import ConsultationSession from "../src/models/ConsultationSession.js";
import consultationSessionFinancialService from "../src/services/consultation-session-financial.service.js";

// Load environment variables from backend/.env
dotenv.config({ path: ".env" });

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("❌ MONGO_URI is not defined in .env");
    process.exit(1);
}

// Parse CLI arguments: node backfill-consultation-sessions.js [--apply]
const args = process.argv.slice(2);
const APPLY_MODE = args.includes("--apply");

if (APPLY_MODE) {
    console.log("⚠️  APPLY MODE ENABLED — ConsultationSession records will be created for eligible Bookings.\n");
} else {
    console.log("🔍 DRY RUN MODE — no ConsultationSession records will be created. Use --apply to enable writes.\n");
}

const runBackfill = async () => {
    try {
        console.log("🔌 Connecting to MongoDB...");
        await mongoose.connect(MONGO_URI);
        console.log("✅ MongoDB connected\n");

        // 1. Find all bookings that already have a ConsultationSession.
        const sessionsWithBooking = await ConsultationSession.find({}, { bookingId: 1 }).lean();
        const existingBookingIds = new Set(sessionsWithBooking.map((s) => s.bookingId.toString()));

        console.log(`📋 Bookings with existing ConsultationSession: ${existingBookingIds.size}`);

        // 2. Aggregate ALL successful payments per booking.
        // A booking may historically have multiple successful payments.
        // We must evaluate every successful payment, not just the first one.
        const successfulPaymentAgg = await Payment.aggregate([
            { $match: { status: "success" } },
            {
                $group: {
                    _id: "$bookingId",
                    successfulPaymentCount: { $sum: 1 },
                    // allFullyRefunded = 1 if EVERY successful payment has refundStatus === "completed".
                    // If ANY successful payment is not fully refunded, the $min will be 0.
                    allFullyRefunded: {
                        $min: {
                            $cond: [{ $eq: ["$refundStatus", "completed"] }, 1, 0],
                        },
                    },
                },
            },
        ]);

        // Build a lookup map: bookingId -> { successfulPaymentCount, allFullyRefunded }
        const paymentStatsByBookingId = new Map();
        for (const row of successfulPaymentAgg) {
            paymentStatsByBookingId.set(row._id.toString(), {
                successfulPaymentCount: row.successfulPaymentCount,
                allFullyRefunded: row.allFullyRefunded === 1,
            });
        }

        const successfulBookingIds = new Set(paymentStatsByBookingId.keys());
        console.log(`💳 Bookings with at least one successful Payment: ${successfulBookingIds.size}`);

        // 3. Candidate booking IDs = paid AND no session.
        const candidateBookingIds = [...successfulBookingIds].filter(
            (id) => !existingBookingIds.has(id)
        );
        console.log(`🎯 Candidate Bookings for backfill: ${candidateBookingIds.length}\n`);

        if (candidateBookingIds.length === 0) {
            console.log("✅ No candidates found. Nothing to do.");
            await mongoose.disconnect();
            console.log("🔌 MongoDB disconnected");
            process.exit(0);
        }

        // 4. Fetch candidate Booking documents in batches and classify.
        const BATCH_SIZE = 100;
        let eligibleCount = 0;
        let refundedExcludedCount = 0;
        let otherExcludedCount = 0;
        let createdCount = 0;
        let skippedExistingCount = 0;
        let failedCount = 0;

        for (let i = 0; i < candidateBookingIds.length; i += BATCH_SIZE) {
            const batchIds = candidateBookingIds.slice(i, i + BATCH_SIZE);
            const bookings = await Booking.find({ _id: { $in: batchIds } }).lean();

            for (const booking of bookings) {
                const stats = paymentStatsByBookingId.get(booking._id.toString());

                if (!stats) {
                    otherExcludedCount += 1;
                    continue;
                }

                const { successfulPaymentCount, allFullyRefunded } = stats;
                const hasNonFullyRefundedPayment = !allFullyRefunded;

                if (successfulPaymentCount > 0 && allFullyRefunded) {
                    refundedExcludedCount += 1;
                    console.log(
                        `REFUNDED_EXCLUDED | bookingId=${booking._id} | clientId=${booking.clientId} | ` +
                        `consultantId=${booking.consultantId} | bookingStatus=${booking.status} | ` +
                        `paymentStatus=${booking.paymentStatus} | successfulPaymentCount=${successfulPaymentCount} | ` +
                        `allFullyRefunded=true`
                    );
                } else if (hasNonFullyRefundedPayment) {
                    eligibleCount += 1;
                    console.log(
                        `ELIGIBLE | bookingId=${booking._id} | clientId=${booking.clientId} | ` +
                        `consultantId=${booking.consultantId} | bookingStatus=${booking.status} | ` +
                        `paymentStatus=${booking.paymentStatus} | successfulPaymentCount=${successfulPaymentCount} | ` +
                        `hasNonFullyRefundedPayment=true`
                    );

                    // In apply mode, create the ConsultationSession for eligible bookings.
                    if (APPLY_MODE) {
                        try {
                            const session = await consultationSessionFinancialService.ensureSessionExists(
                                booking._id
                            );

                            if (session) {
                                createdCount += 1;
                                console.log(
                                    `CREATED | bookingId=${booking._id} | sessionId=${session._id}`
                                );
                            } else {
                                // ensureSessionExists returns null if booking not found.
                                failedCount += 1;
                                console.log(
                                    `FAILED | bookingId=${booking._id} | error=Booking not found during session creation`
                                );
                            }
                        } catch (error) {
                            // Handle duplicate-key (E11000) as a safe skip.
                            if (error && error.code === 11000) {
                                skippedExistingCount += 1;
                                console.log(
                                    `SKIPPED_EXISTING | bookingId=${booking._id} | ` +
                                    `reason=Duplicate key (session already exists)`
                                );
                            } else {
                                failedCount += 1;
                                console.log(
                                    `FAILED | bookingId=${booking._id} | error=${error.message}`
                                );
                            }
                        }
                    }
                } else {
                    otherExcludedCount += 1;
                }
            }
        }

        console.log("\n📊 Summary");
        console.log(`   Eligible candidates:        ${eligibleCount}`);
        if (APPLY_MODE) {
            console.log(`   Created:                    ${createdCount}`);
            console.log(`   Skipped existing:           ${skippedExistingCount}`);
            console.log(`   Failed:                     ${failedCount}`);
        }
        console.log(`   Excluded (fully refunded):  ${refundedExcludedCount}`);
        console.log(`   Excluded (other/missing):   ${otherExcludedCount}`);
        console.log(`   Total candidates reviewed:  ${candidateBookingIds.length}`);

        if (!APPLY_MODE) {
            console.log("\n⚠️  DRY RUN MODE — no ConsultationSession records were created.");
            console.log("    Run with --apply to create sessions for eligible bookings.");
        } else {
            console.log("\n✅ Apply mode complete.");
        }

        await mongoose.disconnect();
        console.log("\n🔌 MongoDB disconnected");
        process.exit(0);

    } catch (error) {
        console.error("❌ Backfill failed:", error.message);
        try {
            await mongoose.disconnect();
            console.log("🔌 MongoDB disconnected");
        } catch {
            // ignore disconnect errors
        }
        process.exit(1);
    }
};

runBackfill();
