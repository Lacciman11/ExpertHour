import express from "express";

import registerMiddlewares, { errorHandler }
    from "./middlewares/index.js";
import registerRoutes from "./routes/index.js";

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
| 404 Handler
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route Not Found",
    });
});

/*
|--------------------------------------------------------------------------
| Global Error Handler
|--------------------------------------------------------------------------
*/

app.use(errorHandler);

export default app;
