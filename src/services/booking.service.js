import mongoose from "mongoose";
import Booking from "../models/Booking.js";
import BookingSlotLock from "../models/BookingSlotLock.js";
import User from "../models/User.js";
import ConsultantProfile from "../models/ConsultantProfile.js";
import ConsultationSession from "../models/ConsultationSession.js";
import Payment from "../models/Payment.js";
import consultantEarningService from "./consultant-earning.service.js";
import googleCalendarService from "./google-calendar.service.js";

import {
    BOOKING_STATUS,
    REFUND_ELIGIBILITY,
    APP_TIMEZONE,
    APP_TIMEZONE_UTC_OFFSET,
    CANCELLATION_WINDOW_MS,
} from "../utils/constants.js";
import { koboToNaira } from "../utils/currency.js";
import ApiError from "../utils/ApiError.js";

/**
 * Slot granularity in minutes.
 * Each booking claims one or more slot locks of this duration.
 */
const SLOT_GRANULARITY_MINUTES = 30;

class BookingService {

    async create(clientId, data) {
        const {
            consultantId,
            consultantProfileId,
            date,
            time,
            duration,
            notes,
        } = data;

        // --- Duration validation ---
        if (typeof duration !== "number" || !Number.isInteger(duration) || duration <= 0) {
            throw new Error("Duration must be a positive integer (minutes)");
        }

        const consultant = await User.findById(consultantId);

        if (!consultant || consultant.role !== "CONSULTANT") {
            throw new Error("Consultant not found");
        }

        const profile = await ConsultantProfile.findById(consultantProfileId);

        if (!profile || !profile.isActive) {
            throw new Error("Consultant profile not found or inactive");
        }

        // --- Currency enforcement ---
        // ExpertHour Paystack payments are NGN-only.
        // Do not silently convert USD or other currencies.
        if (profile.currency !== "NGN") {
            throw new Error(
                `Consultant profile currency must be NGN for Paystack payments. Current currency: ${profile.currency}`
            );
        }

        // --- Server-side price calculation ---
        // hourlyRate is in NGN (e.g., 20000 = ₦20,000)
        // duration is in minutes
        // Formula: (hourlyRate × duration) / 60 = price in NGN
        // Then convert to kobo: priceInNaira × 100
        // Use Math.round for deterministic integer kobo result.
        const priceInKobo = Math.round(profile.hourlyRate * duration * 100 / 60);

        // --- Availability checks ---
        const requestedDate = new Date(date);
        const dayOfWeek = requestedDate.getDay();

        // Use embedded availability slots
        const availabilitySlots = profile.availabilitySlots.filter(
            slot => slot.dayOfWeek === dayOfWeek && slot.isActive
        );

        if (availabilitySlots.length === 0) {
            throw new Error("Consultant is not available on this date");
        }

        // Check if the requested time falls within any availability slot
        const requestedStart = this._timeToMinutes(time);
        const requestedEnd = requestedStart + duration;

        const isWithinAvailability = availabilitySlots.some((slot) => {
            const slotStart = this._timeToMinutes(slot.startTime);
            const slotEnd = this._timeToMinutes(slot.endTime);

            return (
                requestedStart >= slotStart &&
                requestedEnd <= slotEnd
            );
        });

        if (!isWithinAvailability) {
            throw new Error(
                "Selected time is outside consultant's available hours"
            );
        }

        // --- Atomic slot claiming to prevent double-booking race conditions ---
        // Calculate all 30-minute slots covered by this booking.
        // Each slot is claimed atomically using findOneAndUpdate with upsert.
        // The unique compound index on { consultantProfileId, date, slotStart }
        // ensures MongoDB itself enforces mutual exclusion.
        const bookingStartMinutes = requestedStart;
        const bookingEndMinutes = requestedEnd;
        const slotStarts = this._calculateSlotStarts(bookingStartMinutes, bookingEndMinutes);

        // Claim all slots atomically. If any slot is already claimed by another
        // client, the unique index violation will cause a duplicate key error.
        const claimedSlots = [];
        try {
            for (const slotStart of slotStarts) {
                const slotLock = await BookingSlotLock.findOneAndUpdate(
                    {
                        consultantProfileId,
                        date,
                        slotStart,
                    },
                    {
                        $setOnInsert: {
                            consultantProfileId,
                            date,
                            slotStart,
                            clientId,
                            bookingId: null,
                        },
                    },
                    {
                        upsert: true,
                        new: true,
                    }
                );

                // If the slot was already claimed by a DIFFERENT client, conflict.
                // Same client re-requesting (idempotent retry) is allowed.
                if (slotLock.clientId.toString() !== clientId.toString()) {
                    throw new ApiError(
                        409,
                        "This time slot is already booked by another client"
                    );
                }

                claimedSlots.push(slotLock);
            }
        } catch (error) {
            // Clean up any slots we claimed before the conflict.
            // This is best-effort; orphaned slots from same-client retries are harmless.
            if (error instanceof ApiError && error.statusCode === 409) {
                await BookingSlotLock.deleteMany({
                    _id: { $in: claimedSlots.map(s => s._id) },
                    clientId: clientId,
                    bookingId: null,
                });
                throw error;
            }

            // MongoDB duplicate key error (E11000) — another concurrent request
            // claimed this slot between our check and our upsert. Treat as conflict.
            if (error && (error.code === 11000 || error?.cause?.code === 11000)) {
                await BookingSlotLock.deleteMany({
                    _id: { $in: claimedSlots.map(s => s._id) },
                    clientId: clientId,
                    bookingId: null,
                });
                throw new ApiError(
                    409,
                    "This time slot is already booked by another client"
                );
            }

            // Re-throw unexpected errors
            throw error;
        }

        // All slots claimed successfully. Create the booking.
        const booking = await Booking.create({
            clientId,
            consultantId,
            consultantProfileId,
            date,
            time,
            duration,
            amount: priceInKobo,
            notes: notes || "",
            status: BOOKING_STATUS.PENDING,
        });

        // Update slot locks with the booking ID for audit trail.
        // This is non-critical; failure here doesn't affect the booking.
        try {
            await BookingSlotLock.updateMany(
                { _id: { $in: claimedSlots.map(s => s._id) } },
                { $set: { bookingId: booking._id } }
            );
        } catch (updateError) {
            console.error("Failed to update slot locks with booking ID:", updateError);
            // Non-blocking: booking is already created
        }

        return booking;
    }

    /**
     * Calculate all 30-minute slot start times covered by a booking.
     *
     * A booking from 10:00-11:00 claims slots: 10:00, 10:30.
     * A booking from 10:15-11:15 claims slots: 10:00, 10:30.
     * A booking from 10:00-10:30 claims slot: 10:00.
     *
     * @param {number} startMinutes - Booking start time in minutes from midnight
     * @param {number} endMinutes - Booking end time in minutes from midnight
     * @returns {string[]} Array of slot start times in "HH:MM" format
     */
    _calculateSlotStarts(startMinutes, endMinutes) {
        const slots = [];
        // Round down to nearest slot boundary
        const firstSlot = Math.floor(startMinutes / SLOT_GRANULARITY_MINUTES) * SLOT_GRANULARITY_MINUTES;

        for (let slotStart = firstSlot; slotStart < endMinutes; slotStart += SLOT_GRANULARITY_MINUTES) {
            slots.push(this._minutesToTime(slotStart));
        }

        return slots;
    }

    /**
     * Convert minutes from midnight to "HH:MM" format.
     * @param {number} minutes - Minutes from midnight
     * @returns {string} Time in "HH:MM" format
     */
    _minutesToTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
    }

    _timeToMinutes(time) {
        const [hours, minutes] = time.split(":").map(Number);
        return hours * 60 + minutes;
    }

    async findById(id, userId) {
        const booking = await Booking.findById(id)
            .populate("clientId", "firstName lastName email")
            .populate("consultantId", "firstName lastName email")
            .populate("consultantProfileId", "hourlyRate skills");

        if (!booking) {
            throw new ApiError(404, "Booking not found");
        }

        // Authorization: only the booking client or consultant may view the booking
        const isClient = booking.clientId?._id?.toString() === userId.toString();
        const isConsultant = booking.consultantId?._id?.toString() === userId.toString();

        if (!isClient && !isConsultant) {
            throw new ApiError(403, "Not authorized to view this booking");
        }

        booking.amount = koboToNaira(booking.amount);

        return booking;
    }

    async findClientBookings(clientId, filters = {}) {
        const query = { clientId };

        if (filters.status) {
            query.status = filters.status;
        }

        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const skip = (page - 1) * limit;

        const bookings = await Booking.find(query)
            .populate("consultantId", "firstName lastName")
            .populate("consultantProfileId", "hourlyRate skills")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Convert kobo to Naira for API response
        bookings.forEach(booking => {
            booking.amount = koboToNaira(booking.amount);
        });

        const total = await Booking.countDocuments(query);

        return {
            bookings,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async findConsultantBookings(consultantId, filters = {}) {
        const query = { consultantId };

        if (filters.status) {
            query.status = filters.status;
        }

        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const skip = (page - 1) * limit;

        const bookings = await Booking.find(query)
            .populate("clientId", "firstName lastName email")
            .populate("consultantProfileId", "hourlyRate skills")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Convert kobo to Naira for API response
        bookings.forEach(booking => {
            booking.amount = koboToNaira(booking.amount);
        });

        const total = await Booking.countDocuments(query);

        return {
            bookings,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async findUpcomingBookings(clientId) {
        const now = new Date();
        const today = now.toISOString().split("T")[0];

        const bookings = await Booking.find({
            clientId,
            status: { $in: [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED] },
            date: { $gte: today },
        })
            .populate("consultantId", "firstName lastName")
            .populate("consultantProfileId", "hourlyRate skills")
            .sort({ date: 1, time: 1 })
            .limit(5);

        // Convert kobo to Naira for API response
        bookings.forEach(booking => {
            booking.amount = koboToNaira(booking.amount);
        });

        return bookings;
    }

    async updateStatus(id, status) {
        const booking = await Booking.findByIdAndUpdate(
            id,
            { status },
            { new: true, runValidators: true }
        );

        if (!booking) {
            throw new Error("Booking not found");
        }

        return booking;
    }

    /**
     * Confirm a booking. Enforces consultant ownership and valid state transition.
     *
     * Allowed transition: PENDING -> CONFIRMED
     *
     * @param {string} id - Booking ID
     * @param {string} consultantId - Authenticated consultant's user ID
     * @returns {Object} Updated booking
     */
    async confirmBooking(id, consultantId) {
        const booking = await Booking.findById(id);

        if (!booking) {
            throw new ApiError(404, "Booking not found");
        }

        // Ownership check: consultant must own the booking
        if (booking.consultantId.toString() !== consultantId.toString()) {
            throw new ApiError(403, "Not authorized to confirm this booking");
        }

        // State transition check: only PENDING bookings can be confirmed
        if (booking.status === BOOKING_STATUS.CANCELLED) {
            throw new ApiError(400, "Cannot confirm a cancelled booking");
        }

        if (booking.status === BOOKING_STATUS.CONFIRMED) {
            throw new ApiError(400, "Booking is already confirmed");
        }

        if (booking.status === BOOKING_STATUS.COMPLETED) {
            throw new ApiError(400, "Cannot confirm a completed booking");
        }

        if (booking.status !== BOOKING_STATUS.PENDING) {
            throw new ApiError(400, "Booking is not pending");
        }

        booking.status = BOOKING_STATUS.CONFIRMED;
        await booking.save();

        return booking;
    }

    /**
     * Complete a booking. Enforces consultant ownership and valid state transition.
     *
     * Allowed transition: CONFIRMED -> COMPLETED
     *
     * @param {string} id - Booking ID
     * @param {string} consultantId - Authenticated consultant's user ID
     * @returns {Object} Updated booking
     */
    async completeBooking(id, consultantId) {
        const booking = await Booking.findById(id);

        if (!booking) {
            throw new ApiError(404, "Booking not found");
        }

        // Ownership check: consultant must own the booking
        if (booking.consultantId.toString() !== consultantId.toString()) {
            throw new ApiError(403, "Not authorized to complete this booking");
        }

        // State transition check: only CONFIRMED bookings can be completed
        if (booking.status === BOOKING_STATUS.CANCELLED) {
            throw new ApiError(400, "Cannot complete a cancelled booking");
        }

        if (booking.status === BOOKING_STATUS.PENDING) {
            throw new ApiError(400, "Booking must be confirmed before completion");
        }

        if (booking.status === BOOKING_STATUS.COMPLETED) {
            throw new ApiError(400, "Booking is already completed");
        }

        if (booking.status !== BOOKING_STATUS.CONFIRMED) {
            throw new ApiError(400, "Booking is not confirmed");
        }

        booking.status = BOOKING_STATUS.COMPLETED;
        await booking.save();

        return booking;
    }

    /**
     * Cancel a booking with reason and refund eligibility calculation.
     *
     * @param {string} id - Booking ID
     * @param {string} userId - User performing the cancellation
     * @param {Object} options - Cancellation options
     * @param {string} options.reason - Required cancellation reason
     * @param {string} [options.actor] - "client", "consultant", or "admin" (auto-detected if not provided)
     * @returns {Object} Cancelled booking with refund eligibility
     */
    async cancel(id, userId, options = {}) {
        const { reason, actor } = options;

        const booking = await Booking.findById(id);

        if (!booking) {
            throw new Error("Booking not found");
        }

        // Determine who is cancelling
        const isClient = booking.clientId.toString() === userId.toString();
        const isConsultant = booking.consultantId.toString() === userId.toString();

        // Auto-detect actor if not explicitly provided
        let cancelActor = actor;
        if (!cancelActor) {
            if (isClient) cancelActor = "client";
            else if (isConsultant) cancelActor = "consultant";
        }

        // Authorization check
        if (!isClient && !isConsultant && cancelActor !== "admin") {
            throw new Error("Not authorized to cancel this booking");
        }

        // Validate booking can be cancelled
        this._validateCancellationEligibility(booking);

        // Validate cancellation reason is provided
        if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
            throw new Error("Cancellation reason is required");
        }

        // Calculate refund eligibility based on 36-hour rule
        const refundEligibility = this._calculateRefundEligibility(booking);

        // Perform cancellation
        booking.status = BOOKING_STATUS.CANCELLED;
        booking.cancelledAt = new Date();
        booking.cancelledBy = cancelActor;
        booking.cancellationReason = reason.trim();
        booking.refundEligibility = refundEligibility;
        await booking.save();

        // Release slot locks for this booking so the time slot can be re-booked.
        // This is non-critical; failure here doesn't affect the cancellation.
        try {
            await BookingSlotLock.deleteMany({ bookingId: booking._id });
        } catch (slotError) {
            console.error("Failed to release slot locks on cancellation:", slotError);
            // Non-blocking: cancellation should still succeed
        }

        // Increment consultant cancellation count if consultant cancelled
        if (cancelActor === "consultant") {
            await this._incrementConsultantCancellationCount(booking.consultantId);
        }

        // If an earning exists for this booking, mark it as CANCELLED
        await consultantEarningService.cancelEarningForBooking(booking._id);

        // Attempt to delete Google Calendar event if it exists
        if (booking.meetingLink) {
            try {
                await googleCalendarService.deleteEvent(booking.consultantId, booking._id);
            } catch (calendarError) {
                console.error("Failed to delete Google Calendar event:", calendarError);
                // Continue even if calendar deletion fails
            }
        }

        return booking;
    }

    /**
     * Validate that a booking is eligible for cancellation.
     * @param {Object} booking - Booking document
     */
    _validateCancellationEligibility(booking) {
        if (booking.status === BOOKING_STATUS.CANCELLED) {
            throw new Error("Booking is already cancelled");
        }

        if (booking.status === BOOKING_STATUS.COMPLETED) {
            throw new Error("Cannot cancel a completed booking");
        }
    }

    /**
     * Calculate refund eligibility based on 36-hour cancellation window.
     *
     * Rules:
     * - Cancellation ≥36 hours before session = full refund
     * - Cancellation <36 hours before session = no refund
     * - Exactly 36 hours = full refund
     *
     * @param {Object} booking - Booking document
     * @returns {string} REFUND_ELIGIBILITY.FULL or REFUND_ELIGIBILITY.NONE
     */
    _calculateRefundEligibility(booking) {
        // Current time is obtained through a dedicated helper so it can be
        // controlled deterministically in tests without fake timers (which
        // interfere with the in-memory MongoDB server).
        const now = this._getCurrentTime();
        const sessionStartTime = this._getSessionStartTime(booking.date, booking.time);

        // Integer timestamp arithmetic. Avoids floating-point hour division
        // (difference / (1000 * 60 * 60)), which is imprecise at the 36h
        // boundary. Rule: ≥36h remaining = full refund; exactly 36h qualifies.
        const remainingMs = sessionStartTime.getTime() - now.getTime();

        if (remainingMs >= CANCELLATION_WINDOW_MS) {
            return REFUND_ELIGIBILITY.FULL;
        }

        return REFUND_ELIGIBILITY.NONE;
    }

    /**
     * Return the current time as a Date.
     *
     * Isolated as a helper solely so cancellation-boundary tests can control
     * "now" deterministically via a spy, keeping the 36-hour boundary exact
     * without fake timers (which break the in-memory MongoDB server).
     * @returns {Date} Current time
     */
    _getCurrentTime() {
        return new Date();
    }

    /**
     * Calculate session start time from date and time strings.
     * @param {string} date - Date string (YYYY-MM-DD)
     * @param {string} time - Time string (HH:MM)
     * @returns {Date} Session start time
     */
    _getSessionStartTime(date, time) {
        const [hours, minutes] = time.split(":").map(Number);
        // Parse as wall-clock time in the application business timezone
        // (Africa/Lagos). The offset is a fixed constant because Nigeria does
        // not observe daylight saving time.
        const sessionDate = new Date(`${date}T${time}:00${APP_TIMEZONE_UTC_OFFSET}`);
        return sessionDate;
    }

    /**
     * Increment the consultant's cancellation count.
     * @param {string} consultantId - Consultant user ID
     */
    async _incrementConsultantCancellationCount(consultantId) {
        try {
            await ConsultantProfile.findOneAndUpdate(
                { userId: consultantId },
                { $inc: { cancellationCount: 1 } },
                { new: true }
            );
        } catch (error) {
            console.error("Failed to increment consultant cancellation count:", error);
            // Non-blocking: cancellation should still succeed
        }
    }

    /**
     * Generate (or return an existing) meeting link for a booking.
     *
     * Authorization (AUTH-05, must remain intact):
     *   Only the booking's client or consultant may receive a meeting link.
     *   Admins, other users, and unauthenticated callers are rejected.
     *
     * State machine:
     *   - cancelled           → reject (400)
     *   - completed           → idempotent: return existing link if present,
     *                           otherwise reject (400) — a completed session
     *                           does not need a freshly generated link.
     *   - pending             → reject (400). Successful payment reconciliation
     *                           auto-transitions pending → confirmed, so a
     *                           legitimate ready-for-consultation booking is
     *                           always confirmed at this point.
     *   - confirmed           → require successful Payment (status === "success")
     *                           before generating / returning the link.
     *
     * Idempotency:
     *   If the booking already has a meeting link and all other guards pass,
     *   the existing link is returned unchanged. We do NOT regenerate.
     *
     * Local validation only:
     *   This endpoint MUST NOT call Paystack or trigger payment reconciliation.
     *   It only validates existing local Booking + Payment state.
     */
    async generateMeetingLink(id, userId) {
        const booking = await Booking.findById(id);

        if (!booking) {
            throw new ApiError(404, "Booking not found");
        }

        // AUTH-05 — ownership check. No admin bypass.
        const isClient = booking.clientId.toString() === userId.toString();
        const isConsultant = booking.consultantId.toString() === userId.toString();

        if (!isClient && !isConsultant) {
            throw new ApiError(
                403,
                "Not authorized to generate meeting link for this booking"
            );
        }

        // Booking state guard. Cancelled bookings cannot receive a link.
        if (booking.status === BOOKING_STATUS.CANCELLED) {
            throw new ApiError(
                400,
                "Cannot generate meeting link for a cancelled booking"
            );
        }

        // Pending bookings are not ready for consultation. Successful payment
        // reconciliation always transitions pending → confirmed, so any
        // pending booking reaching this endpoint has not been paid.
        if (booking.status === BOOKING_STATUS.PENDING) {
            throw new ApiError(
                400,
                "Meeting link is only available after the booking is confirmed (payment completed)"
            );
        }

        // Completed bookings: idempotent — return existing link if present,
        // otherwise reject (a completed session does not need a new link).
        if (booking.status === BOOKING_STATUS.COMPLETED) {
            if (booking.meetingLink && booking.meetingLink.length > 0) {
                return booking;
            }
            throw new ApiError(
                400,
                "Cannot generate a new meeting link for a completed booking"
            );
        }

        // From here on, booking.status === "confirmed".
        // Confirmed bookings still require a successful payment to receive
        // a meeting link — covers the edge case of a manually-confirmed
        // booking that was never paid (e.g., admin bypass or data drift).

        if (!booking.paymentReference || booking.paymentReference.length === 0) {
            throw new ApiError(
                400,
                "Meeting link is only available after successful payment"
            );
        }

        // Load the associated Payment record.
        const payment = await Payment.findOne({
            reference: booking.paymentReference,
        });

        if (!payment) {
            throw new ApiError(
                400,
                "Meeting link is only available after successful payment"
            );
        }

        // Canonical success status from Payment model enum:
        //   ["pending", "processing", "success", "failed", "abandoned"]
        if (payment.status !== "success") {
            throw new ApiError(
                400,
                "Meeting link is only available after successful payment"
            );
        }

        // Idempotency: if a link was already generated for this valid
        // (confirmed + paid) booking, return it unchanged.
        if (booking.meetingLink && booking.meetingLink.length > 0) {
            return booking;
        }

        const meetingLink = `https://experthour.onrender.com/meeting/${booking._id}`;

        booking.meetingLink = meetingLink;
        await booking.save();

        return booking;
    }

    async findAll(filters = {}) {
        const query = {};

        if (filters.status) {
            query.status = filters.status;
        }

        if (filters.consultantId) {
            query.consultantId = filters.consultantId;
        }

        if (filters.clientId) {
            query.clientId = filters.clientId;
        }

        const page = parseInt(filters.page) || 1;
        const limit = parseInt(filters.limit) || 10;
        const skip = (page - 1) * limit;

        const bookings = await Booking.find(query)
            .populate("consultantId", "firstName lastName email")
            .populate("consultantProfileId", "hourlyRate skills")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        // Convert kobo to Naira for API response
        bookings.forEach(booking => {
            booking.amount = koboToNaira(booking.amount);
        });

        const total = await Booking.countDocuments(query);

        return {
            bookings,
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        };
    }

    async getStats(consultantId) {
        const totalBookings = await Booking.countDocuments({ consultantId });
        const pendingBookings = await Booking.countDocuments({
            consultantId,
            status: BOOKING_STATUS.PENDING,
        });
        const confirmedBookings = await Booking.countDocuments({
            consultantId,
            status: BOOKING_STATUS.CONFIRMED,
        });
        const completedBookings = await Booking.countDocuments({
            consultantId,
            status: BOOKING_STATUS.COMPLETED,
        });
        const cancelledBookings = await Booking.countDocuments({
            consultantId,
            status: BOOKING_STATUS.CANCELLED,
        });

        const revenueResult = await Booking.aggregate([
            {
                $match: {
                    consultantId: new mongoose.Types.ObjectId(consultantId),
                    status: BOOKING_STATUS.COMPLETED,
                },
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: "$amount" },
                },
            },
        ]);

        const totalRevenue = revenueResult.length > 0 ? revenueResult[0].totalRevenue : 0;

        // Get consultant profile for rating
        const consultantProfile = await ConsultantProfile.findOne({ userId: consultantId });
        const rating = consultantProfile ? consultantProfile.rating : 0;

        return {
            totalBookings,
            pendingBookings,
            confirmedBookings,
            completedBookings,
            cancelledBookings,
            totalRevenue,
            rating,
        };
    }

    /**
     * Accept a booking (pending -> confirmed).
     *
     * FINDING-B03: the state transition uses an atomic conditional update so
     * that two concurrent accept/decline operations against the same PENDING
     * booking result in exactly one winner. The filter includes the expected
     * current status, ownership, and identity, so the database — not
     * application logic — enforces mutual exclusion.
     *
     * @param {string} id - Booking ID
     * @param {string} consultantId - Authenticated consultant's user ID
     * @returns {Object} Updated booking (confirmed)
     */
    async acceptBooking(id, consultantId) {
        const booking = await Booking.findOneAndUpdate(
            {
                _id: id,
                consultantId: consultantId,
                status: BOOKING_STATUS.PENDING,
            },
            {
                $set: { status: BOOKING_STATUS.CONFIRMED },
            },
            {
                new: true,
            }
        );

        if (booking) {
            return booking;
        }

        // The atomic transition matched nothing. Classify the reason with a
        // follow-up read so we can return a precise status code. This read is
        // purely diagnostic and cannot undo the atomic transition.
        const existing = await Booking.findById(id);

        if (!existing) {
            throw new ApiError(404, "Booking not found");
        }

        if (existing.consultantId.toString() !== consultantId.toString()) {
            throw new ApiError(403, "Not authorized to accept this booking");
        }

        // Booking exists and is owned, but is no longer pending.
        throw new ApiError(409, "Booking is no longer pending");
    }

    /**
     * Decline a booking (pending -> cancelled).
     *
     * FINDING-B03: atomic conditional update (see acceptBooking). The earning
     * cancellation side effect runs ONLY after a confirmed successful state
     * transition, so a losing concurrent request never triggers it.
     *
     * @param {string} id - Booking ID
     * @param {string} consultantId - Authenticated consultant's user ID
     * @returns {Object} Updated booking (cancelled)
     */
    async declineBooking(id, consultantId) {
        const booking = await Booking.findOneAndUpdate(
            {
                _id: id,
                consultantId: consultantId,
                status: BOOKING_STATUS.PENDING,
            },
            {
                $set: { status: BOOKING_STATUS.CANCELLED },
            },
            {
                new: true,
            }
        );

        if (!booking) {
            // The atomic transition matched nothing. Classify the reason.
            const existing = await Booking.findById(id);

            if (!existing) {
                throw new ApiError(404, "Booking not found");
            }

            if (existing.consultantId.toString() !== consultantId.toString()) {
                throw new ApiError(403, "Not authorized to decline this booking");
            }

            // Booking exists and is owned, but is no longer pending.
            throw new ApiError(409, "Booking is no longer pending");
        }

        // Side effect ONLY after a confirmed atomic transition. This guards
        // against duplicate earning cancellations when concurrent requests race.
        // If an earning exists for this booking, mark it as CANCELLED.
        await consultantEarningService.cancelEarningForBooking(booking._id);

        return booking;
    }
}

export default new BookingService();
