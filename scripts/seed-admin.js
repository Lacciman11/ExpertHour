import mongoose from "mongoose";
import dotenv from "dotenv";

import User from "../src/models/User.js";
import { USER_ROLES } from "../src/utils/constants.js";

// Load environment variables from backend/.env
dotenv.config({ path: ".env" });

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("❌ MONGO_URI is not defined in .env");
    process.exit(1);
}

// Parse CLI arguments: node seed-admin.js [email] [password]
const args = process.argv.slice(2);
const adminEmail = args[0] || "admin@experthour.com";
const adminPassword = args[1] || "Admin@123";

const seedAdmin = async () => {
    try {
        console.log("🔌 Connecting to MongoDB...");
        await mongoose.connect(MONGO_URI);
        console.log("✅ MongoDB connected");

        const existingAdmin = await User.findOne({ email: adminEmail });

        if (existingAdmin) {
            console.log(`⚠️  Admin with email ${adminEmail} already exists.`);
            console.log("   Skipping creation.");
            await mongoose.disconnect();
            console.log("🔌 MongoDB disconnected");
            process.exit(0);
        }

        console.log("👤 Creating admin user...");

        const admin = await User.create({
            firstName: "Admin",
            lastName: "User",
            email: adminEmail,
            password: adminPassword,
            role: USER_ROLES.ADMIN,
            isVerified: true,
            isActive: true,
        });

        console.log("✅ Admin user created successfully!");
        console.log(`   Email:    ${admin.email}`);
        console.log(`   Role:     ${admin.role}`);
        console.log(`   User ID:  ${admin._id}`);

        await mongoose.disconnect();
        console.log("🔌 MongoDB disconnected");
        process.exit(0);

    } catch (error) {
        console.error("❌ Error seeding admin:", error.message);
        await mongoose.disconnect();
        process.exit(1);
    }
};

seedAdmin();
