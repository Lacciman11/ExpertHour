import { Router } from "express";

import {
    getProfile,
    updateProfile,
    changePassword,
    uploadAvatar,
    deleteAvatar,
    deleteAccount,
} from "../controllers/profile.controller.js";

import {
    updateProfileValidator,
    changePasswordValidator,
} from "../validators/profile.validator.js";

import validate from "../middlewares/validate.middleware.js";
import authenticate from "../middlewares/auth.middleware.js";
import { uploadAvatar as uploadAvatarMiddleware } from "../middlewares/upload.middleware.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| All profile routes require authentication
|--------------------------------------------------------------------------
*/

router.use(authenticate);

router.get("/", getProfile);

router.patch(
    "/",
    updateProfileValidator,
    validate,
    updateProfile
);

router.post(
    "/change-password",
    changePasswordValidator,
    validate,
    changePassword
);

router.post(
    "/avatar",
    uploadAvatarMiddleware,
    uploadAvatar
);

router.delete("/avatar", deleteAvatar);

router.delete("/", deleteAccount);

export default router;
