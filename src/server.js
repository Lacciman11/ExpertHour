import dotenv from "dotenv";
dotenv.config();

import app from "./app.js";
import env from "./config/env.js";
import connectDB from "./config/db.js";

const startServer = async () => {
    try {
        await connectDB();

        app.listen(env.port, () => {
            console.log(
                ` Server running on http://localhost:${env.port}`
            );
        });

    } catch (error) {
        console.error("Application failed to start");
        console.error(error.message);

        process.exit(1);
    }
};

startServer();