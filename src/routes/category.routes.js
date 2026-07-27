import { Router } from "express";

import {
    createCategory,
    getAllCategories,
    getCategoryById,
    updateCategory,
    deleteCategory,
} from "../controllers/category.controller.js";

import {
    createCategoryValidator,
    updateCategoryValidator,
    categoryIdParamValidator,
    categoryQueryValidator,
} from "../validators/category.validator.js";

import validate from "../middlewares/validate.middleware.js";
import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/role.middleware.js";

const router = Router();

/*
|--------------------------------------------------------------------------
| Public Routes
|--------------------------------------------------------------------------
*/

// Get all categories (public)
router.get(
    "/",
    categoryQueryValidator,
    validate,
    getAllCategories
);

// Get category by ID (public)
router.get(
    "/:id",
    categoryIdParamValidator,
    validate,
    getCategoryById
);

/*
|--------------------------------------------------------------------------
| Admin Routes
|--------------------------------------------------------------------------
*/

const adminRouter = Router();

adminRouter.use(authenticate);
adminRouter.use(authorize("ADMIN"));

// Create category
adminRouter.post(
    "/",
    createCategoryValidator,
    validate,
    createCategory
);

// Update category
adminRouter.patch(
    "/:id",
    categoryIdParamValidator,
    updateCategoryValidator,
    validate,
    updateCategory
);

// Delete category
adminRouter.delete(
    "/:id",
    categoryIdParamValidator,
    validate,
    deleteCategory
);

router.use("/admin", adminRouter);

export default router;
