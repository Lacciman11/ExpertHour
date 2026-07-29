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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const registerMiddlewares = (app) => {

    // Parse JSON requests
    app.use(express.json());

    // Parse URL Encoded Data
    app.use(express.urlencoded({ extended: true }));

    // Enable CORS
    const allowedOrigins = env.appUrl ? [env.appUrl] : []

    // Allow Vite dev server and common frontend origins in development
    if (process.env.NODE_ENV === 'development') {
        allowedOrigins.push(
            'http://localhost:5000',
            'http://localhost:5001',
            'http://127.0.0.1:3000',
            'http://localhost:3000',
            'http://localhost:4173',
            'http://127.0.0.1:5173',
            'http://localhost:5173',
            'http://localhost:4200',
            'http://127.0.0.1:4200',
        )
    }

    app.use(
        cors({
            origin: function (origin, callback) {
                // Allow requests with no origin (like mobile apps or curl requests)
                if (!origin) return callback(null, true)
                if (allowedOrigins.indexOf(origin) !== -1) {
                    return callback(null, true)
                }
                // In development, allow all origins
                if (process.env.NODE_ENV === 'development') {
                    return callback(null, true)
                }
                return callback(new Error('Not allowed by CORS'))
            },
            credentials: true,
        })
    )

    // Secure HTTP Headers
    app.use(helmet())

    // Compress Responses
    app.use(compression())

    // Parse Cookies
    app.use(cookieParser())

    // HTTP Logger
    app.use(morgan("dev"))

    // Static Files
    app.use(express.static(path.join(__dirname, "../public")))

    return app

}

export default registerMiddlewares
export { errorHandler }
