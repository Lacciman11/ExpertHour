import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import registerMiddlewares, { errorHandler }
    from "./middlewares/index.js";
import registerRoutes from "./routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/*
|--------------------------------------------------------------------------
| Global Middlewares
|--------------------------------------------------------------------------
*/

registerMiddlewares(app);

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
*/

registerRoutes(app);

/*
|--------------------------------------------------------------------------
| Health Check
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Welcome to ExpertHour API 🚀",
    });
});

/*
|--------------------------------------------------------------------------
| Serve Frontend (SPA fallback)
|--------------------------------------------------------------------------
*/

app.use(express.static(path.join(__dirname, "../public")));

app.get("/{*path}", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/index.html"));
});

/*
|--------------------------------------------------------------------------
| Global Error Handler
|--------------------------------------------------------------------------
*/

app.use(errorHandler);

export default app;
