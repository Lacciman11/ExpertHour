import mongoose from "mongoose";

/**
 * BookingSlotLock — Prevents double-booking race conditions.
 *
 * Each booking claims one or more 30-minute slot locks. The unique compound
 * index on { consultantProfileId, date, slotStart } ensures that MongoDB
 * itself enforces mutual exclusion: two concurrent requests cannot both
 * insert the same slot lock.
 *
 * Slot granularity: 30 minutes.
 * A booking from 10:00-11:00 claims slots: 10:00, 10:30.
 * A booking from 10:15-11:15 claims slots: 10:00, 10:30.
 *
 * This is a permanent record of slot occupancy. Cancelled bookings retain
 * their slot locks (the conflict check excludes CANCELLED bookings, so a
 * cancelled booking's slots can be re-booked by a new booking that claims
 * them first).
 */
const bookingSlotLockSchema = new mongoose.Schema(
    {
        consultantProfileId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ConsultantProfile",
            required: [true, "Consultant profile ID is required"],
        },

        date: {
            type: String,
            required: [true, "Date is required"],
        },

        /**
         * Slot start time in HH:MM format.
         * Always a multiple of 30 minutes (e.g., "10:00", "10:30", "11:00").
         */
        slotStart: {
            type: String,
            required: [true, "Slot start time is required"],
        },

        /**
         * The client who claimed this slot.
         * Used to detect if the same client is re-requesting (idempotent retry).
         */
        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Client ID is required"],
        },

        /**
         * The booking that owns this slot lock.
         * Set after the booking is created.
         */
        bookingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Booking",
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

/**
 * Unique compound index: only one slot lock per consultant/date/slotStart.
 * This is the core mechanism that prevents double-booking.
 */
bookingSlotLockSchema.index(
    { consultantProfileId: 1, date: 1, slotStart: 1 },
    { unique: true }
);

const BookingSlotLock = mongoose.model("BookingSlotLock", bookingSlotLockSchema);

export default BookingSlotLock;
