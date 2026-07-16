import { Router } from "express";

import { register } from "../controllers/auth.controller.js";

import { registerValidator } from "../validators/auth.validator.js";

import validate from "../middlewares/validate.middleware.js";

const router = Router();

router.post(
    "/register",
    registerValidator,
    validate,
    register
);

export default router;