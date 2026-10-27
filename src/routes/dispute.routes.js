import { Router } from "express";
import authenticate from "../middlewares/auth.middleware.js";
import authorize from "../middlewares/role.middleware.js";
import { openDispute, resolveDispute } from "../controllers/dispute.controller.js";

const router = Router();
router.use(authenticate());
router.post("/", openDispute);
router.patch("/:id/resolve", authorize("ADMIN"), resolveDispute);
export default router;