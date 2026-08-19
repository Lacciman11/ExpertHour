import app from "./app.js";
import env, { validateEnv } from "./config/env.js";
import connectDB from "./config/db.js";
import Category from "./models/Category.js";
import paymentReconciliationService from "./services/payment-reconciliation.service.js";

const DEFAULT_CATEGORIES = [
    "Strategy",
    "Sales",
    "Marketing",
    "Finance",
    "HR",
    "Operations",
    "Digital",
    "Leadership",
    "Customer Experience",
    "Startup",
];

const seedCategories = async () => {
    const count = await Category.countDocuments();
    if (count > 0) {
        console.log(`Categories already seeded (${count} categories found)`);
        return;
    }

    console.log("Seeding default categories...");
    for (const name of DEFAULT_CATEGORIES) {
        await Category.create({
            name,
            description: `${name} consulting services`,
        });
    }
    console.log(`Seeded ${DEFAULT_CATEGORIES.length} default categories`);
};

const startServer = async () => {
    try {
        validateEnv();

        await connectDB();

        await seedCategories();

        const server = app.listen(env.port, () => {
            console.log(
                ` Server running on http://localhost:${env.port}`
            );

            // Start the payment reconciliation worker only after the server is listening
            // and the database connection is established.
            paymentReconciliationService.start();
        });

        // Graceful shutdown handlers
        const gracefulShutdown = (signal) => {

            console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);

            paymentReconciliationService.stop();

            server.close(() => {

                console.log("[Server] HTTP server closed");

                process.exit(0);

            });

            // Force exit after timeout if server doesn't close in time
            setTimeout(() => {

                console.error("[Server] Forced shutdown after timeout");

                process.exit(1);

            }, 10000);

        };

        process.on("SIGINT", () => gracefulShutdown("SIGINT"));

        process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

    } catch (error) {
        console.error("Application failed to start");
        console.error(error.message);

        process.exit(1);
    }
};

startServer();