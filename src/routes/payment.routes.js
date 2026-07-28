import { Router } from "express";

import {
    initializePayment,
    verifyPayment,
    handleWebhook,
} from "../controllers/payment.controller.js";

import validate from "../middlewares/validate.middleware.js";
import authenticate from "../middlewares/auth.middleware.js";

const router = Router();

router.use(authenticate);

router.post("/initialize", initializePayment);

router.get("/verify/:reference", verifyPayment);

router.post("/webhook", handleWebhook);

export default router;
