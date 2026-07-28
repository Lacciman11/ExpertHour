import axios from "axios";
import Booking from "../models/Booking.js";
import User from "../models/User.js";

class PaymentService {

    async initializePayment(bookingId, amount, email, userId) {

        const booking = await Booking.findById(bookingId);

        if (!booking) {

            throw new Error("Booking not found");

        }

        if (booking.clientId.toString() !== userId.toString()) {

            throw new Error("Not authorized to pay for this booking");

        }

        const reference = `EXP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const payload = {

            email,

            amount: Math.round(amount * 100), // Paystack expects amount in kobo/cents

            reference,

            metadata: {

                bookingId: booking._id.toString(),

                clientId: userId.toString(),

                consultantId: booking.consultantId.toString(),

            },

        };

        try {

            const response = await axios.post(

                "https://api.paystack.co/transaction/initialize",

                payload,

                {

                    headers: {

                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

                        "Content-Type": "application/json",

                    },

                }

            );

            const paymentData = {

                bookingId: booking._id,

                reference,

                amount,

                status: "pending",

                paymentMethod: "paystack",

                paidBy: userId,

            };

            booking.paymentReference = reference;
            booking.paymentStatus = "pending";
            await booking.save();

            return {

                authorizationUrl: response.data.data.authorization_url,

                accessCode: response.data.data.access_code,

                reference,

            };

        } catch (error) {

            throw new Error("Failed to initialize payment: " + error.message);

        }

    }

    async verifyPayment(reference) {

        try {

            const response = await axios.get(

                `https://api.paystack.co/transaction/verify/${reference}`,

                {

                    headers: {

                        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,

                    },

                }

            );

            const paymentData = response.data.data;

            const booking = await Booking.findOne({ paymentReference: reference });

            if (!booking) {

                throw new Error("Booking not found for this payment");

            }

            if (paymentData.status === "success") {

                booking.paymentStatus = "paid";
                booking.status = "confirmed";
                await booking.save();

                return {

                    success: true,

                    booking,

                    payment: paymentData,

                };

            } else {

                booking.paymentStatus = "failed";
                await booking.save();

                return {

                    success: false,

                    booking,

                    payment: paymentData,

                };

            }

        } catch (error) {

            throw new Error("Failed to verify payment: " + error.message);

        }

    }

    async handleWebhook(payload) {

        const { event, data } = payload;

        if (event === "charge.success") {

            const reference = data.reference;

            const booking = await Booking.findOne({ paymentReference: reference });

            if (booking) {

                booking.paymentStatus = "paid";
                booking.status = "confirmed";
                await booking.save();

            }

        }

        return { success: true };

    }

}

export default new PaymentService();
