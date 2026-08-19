import { Router } from "express";

import {
    createReview,
    getConsultantReviews,
    getMyReviews,
} from "../controllers/review.controller.js";

import {
    createReviewValidator,
    reviewQueryValidator,
} from "../validators/review.validator.js";

import validate from "../middlewares/validate.middleware.js";
import authenticate from "../middlewares/auth.middleware.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| All review routes require authentication
|--------------------------------------------------------------------------
*/

router.use(authenticate());

/*
|--------------------------------------------------------------------------
| Client Routes
|--------------------------------------------------------------------------
*/

router.post(
    "/",
    createReviewValidator,
    validate,
    createReview
);

router.get(
    "/my-reviews",
    reviewQueryValidator,
    validate,
    getMyReviews
);

/*
|--------------------------------------------------------------------------
| Public Routes
|--------------------------------------------------------------------------
*/

router.get(
    "/consultant/:consultantId",
    reviewQueryValidator,
    validate,
    getConsultantReviews
);

export default router;
