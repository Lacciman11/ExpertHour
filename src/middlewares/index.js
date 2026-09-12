import path from "path";
import { fileURLToPath } from "url";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import morgan from "morgan";

import env from "../config/env.js";
import errorHandler from "./error.middleware.js";
import correlationMiddleware from "./correlation.middleware.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const registerMiddlewares = (app) => {

    // Correlation ID must be first so all subsequent middleware/handlers can use it.
    app.use(correlationMiddleware);

    // Parse JSON requests
    app.use(express.json());

    // Parse URL Encoded Data
    app.use(express.urlencoded({ extended: true }));

    // Enable CORS
const allowedOrigins = [
    env.appUrl,
    process.env.FRONTEND_URL,
    "http://localhost:5000",
    "http://localhost:5173",
].filter(Boolean);

    app.use(
        cors({
            origin: allowedOrigins.length > 0 ? allowedOrigins : false,
            credentials: true,
        })
    );

    // Secure HTTP Headers
    app.use(helmet());

    // Compress Responses
    app.use(compression());

    // Parse Cookies
    app.use(cookieParser());

    // HTTP Logger
    app.use(morgan("dev"));

    // Static Files
    app.use(express.static(path.join(__dirname, "../public")));

    return app;

};

export default registerMiddlewares;
export { errorHandler };
