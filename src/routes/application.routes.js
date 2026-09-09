import { Router } from "express";

import { submitApplication } from "../controllers/application.controller.js";

import { applicationValidator } from "../validators/application.validator.js";

import validate from "../middlewares/validate.middleware.js";

import { uploadCV } from "../middlewares/upload.middleware.js";

const router = Router();

router.post(
    "/",
    uploadCV,
    applicationValidator,
    validate,
    submitApplication
);

export default router;
