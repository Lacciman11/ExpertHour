import { Router } from "express";

import { submitApplication } from "../controllers/application.controller.js";

import applicationValidator from "../validators/application.validator.js";

import validate from "../middlewares/validate.middleware.js";

import { uploadApplicationFiles } from "../middlewares/upload.middleware.js";

const router = Router();

router.post(
    "/",
    uploadApplicationFiles,
    applicationValidator,
    validate,
    submitApplication
);

export default router;
