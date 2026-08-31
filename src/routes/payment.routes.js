import { Router } from "express";

import {
    initializePayment,
    verifyPayment,
    handleWebhook,
    generateMeetingLink,
    retryPayment,
    initiateRefund,
    checkRefundStatus,
} from "../controllers/payment.controller.js";

import validate from "../middlewares/validate.middleware.js";
import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/role.middleware.js";
import { rateLimit } from "express-rate-limit";

const router = Router();

/**
 * Rate limiter for payment verification endpoint.
 * Prevents abuse while allowing legitimate re-verification.
 */
const verifyPaymentLimiter = rateLimit({

    windowMs: 15 * 60 * 1000, // 15 minutes

    max: 30, // 30 requests per 15 minutes per IP

    standardHeaders: true,

    legacyHeaders: false,

    message: {

        success: false,

        message: "Too many verification requests. Please try again later.",

    },

});

/**
 * Rate limiter for webhook endpoint.
 * Allows legitimate Paystack retries while preventing abuse.
 */
const webhookLimiter = rateLimit({

    windowMs: 15 * 60 * 1000, // 15 minutes

    max: 200, // 200 requests per 15 minutes per IP

    standardHeaders: true,

    legacyHeaders: false,

    message: {

        success: false,

        message: "Too many webhook requests. Please try again later.",

    },

});

// Webhook must be public — Paystack does not send JWT tokens.
// Authentication is performed via Paystack webhook signature verification.
router.post("/webhook", webhookLimiter, handleWebhook);

// Authenticated routes
router.use(authenticate());

router.post("/initialize", initializePayment);

router.get("/verify/:reference", verifyPaymentLimiter, verifyPayment);

router.post("/generate-meeting-link", generateMeetingLink);

router.post("/retry/:bookingId", retryPayment);

// Refund endpoints - ADMIN only. Consultants and clients must not initiate refunds.
router.post("/refund/:paymentId", authorize("ADMIN"), initiateRefund);

router.get("/refund/:paymentId/status", authorize("ADMIN"), checkRefundStatus);

export default router;
