import ConsultantAvailability from "../models/ConsultantAvailability.js";
import ConsultantProfile from "../models/ConsultantProfile.js";
import Booking from "../models/Booking.js";

class AvailabilityService {

    async findByConsultantProfileId(profileId) {

        const slots = await ConsultantAvailability.find({
            consultantProfileId: profileId,
            isActive: true,
        }).sort({ dayOfWeek: 1, startTime: 1 });

        return slots;

    }

    async setAvailability(profileId, slots) {

        // Delete existing slots for this consultant
        await ConsultantAvailability.deleteMany({
            consultantProfileId: profileId,
        });

        // Create new slots
        const createdSlots = [];

        for (const slot of slots) {

            const { dayOfWeek, startTime, endTime } = slot;

            // Validate time range
            if (this._timeToMinutes(endTime) <= this._timeToMinutes(startTime)) {
                throw new Error("End time must be after start time");
            }

            const availabilitySlot = await ConsultantAvailability.create({
                consultantProfileId: profileId,
                dayOfWeek,
                startTime,
                endTime,
                isActive: true,
            });

            createdSlots.push(availabilitySlot);

        }

        return createdSlots;

    }

    async deleteSlot(slotId, consultantUserId) {

        const profile = await ConsultantProfile.findOne({ userId: consultantUserId });

        if (!profile) {
            throw new Error("Consultant profile not found");
        }

        const slot = await ConsultantAvailability.findOne({
            _id: slotId,
            consultantProfileId: profile._id,
        });

        if (!slot) {
            throw new Error("Availability slot not found");
        }

        await slot.deleteOne();

        return slot;

    }

    async getAvailableSlots(profileId, date) {

        const targetDate = new Date(date);
        const dayOfWeek = targetDate.getDay();

        const slots = await ConsultantAvailability.find({
            consultantProfileId: profileId,
            dayOfWeek,
            isActive: true,
        }).sort({ startTime: 1 });

        // Check which slots are already booked
        const bookings = await Booking.find({
            consultantProfileId: profileId,
            date: date,
            status: { $in: ["pending", "confirmed"] },
        });

        const bookedTimes = bookings.map((b) => ({
            time: b.time,
            duration: b.duration,
        }));

        // Generate available time slots (30-min intervals)
        const availableSlots = [];

        for (const slot of slots) {

            const startMinutes = this._timeToMinutes(slot.startTime);
            const endMinutes = this._timeToMinutes(slot.endTime);

            for (let minutes = startMinutes; minutes < endMinutes; minutes += 30) {

                const slotStart = this._minutesToTime(minutes);
                const slotEnd = this._minutesToTime(minutes + 30);

                // Check if this slot conflicts with any booking
                const isBooked = bookedTimes.some((booking) => {
                    const bookingStart = this._timeToMinutes(booking.time);
                    const bookingEnd = bookingStart + booking.duration;

                    return (
                        minutes >= bookingStart &&
                        minutes < bookingEnd
                    );
                });

                if (!isBooked) {
                    availableSlots.push({
                        time: slotStart,
                        endTime: slotEnd,
                    });
                }

            }

        }

        return availableSlots;

    }

    _timeToMinutes(time) {

        const [hours, minutes] = time.split(":").map(Number);

        return hours * 60 + minutes;

    }

    _minutesToTime(minutes) {

        const hours = Math.floor(minutes / 60);

        const mins = minutes % 60;

        return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;

    }

}

export default new AvailabilityService();
