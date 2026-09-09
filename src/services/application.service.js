import Application from "../models/Application.js";
import cloudinaryService from "./cloudinary.service.js";
import googleSheetsService from "./google-sheets.service.js";
import ApiError from "../utils/ApiError.js";
import { APP_TIMEZONE } from "../utils/constants.js";

class ApplicationService {

    async createApplication(data, cvFile) {

        // Validate required fields
        if (!data.fullName?.trim()) {
            throw new ApiError(400, "Full name is required");
        }

        if (!data.email?.trim()) {
            throw new ApiError(400, "Email is required");
        }

        if (!data.phone?.trim()) {
            throw new ApiError(400, "Phone number is required");
        }

        if (!data.currentTitle?.trim()) {
            throw new ApiError(400, "Current title is required");
        }

        if (!data.organisation?.trim()) {
            throw new ApiError(400, "Organisation name is required");
        }

        if (!data.yearsExperience?.trim()) {
            throw new ApiError(400, "Years of experience is required");
        }

        if (!data.primaryIndustry?.trim()) {
            throw new ApiError(400, "Primary industry is required");
        }

        if (!data.primaryExpertise?.trim()) {
            throw new ApiError(400, "Primary expertise is required");
        }

        if (!data.whyJoin?.trim()) {
            throw new ApiError(400, "Please tell us why you would like to join");
        }

        if (!data.consent || data.consent !== "Yes") {
            throw new ApiError(400, "Consent is required");
        }

        // Check for duplicate email
        const existingApplication = await Application.findOne({ email: data.email.toLowerCase() });

        if (existingApplication) {

            throw new ApiError(400, "An application with this email already exists");

        }

        // Upload CV to Cloudinary if provided
        let cvData = {
            url: "",
            publicId: "",
            originalName: "",
            mimeType: "",
        };

        if (cvFile) {

            const maxSize = 10 * 1024 * 1024; // 10MB

            if (cvFile.size > maxSize) {

                throw new ApiError(400, "CV must be less than 10MB");

            }

            const allowedTypes = [
                "application/pdf",
                "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ];

            if (!allowedTypes.includes(cvFile.mimetype)) {

                throw new ApiError(400, "Invalid CV file type. Only PDF, DOC, and DOCX are allowed.");

            }

            const uploadResult = await cloudinaryService.uploadCV(cvFile);

            cvData = {
                url: uploadResult.url,
                publicId: uploadResult.publicId,
                originalName: cvFile.originalname || cvFile.filename || "cv",
                mimeType: cvFile.mimetype,
            };

        }

        // Create application in MongoDB
        const application = await Application.create({

            ...data,

            email: data.email.toLowerCase(),

            cv: cvData,

        });

        // Attempt to sync to Google Sheets (non-critical)
        try {

            await googleSheetsService.appendApplication(application);

            await Application.findByIdAndUpdate(application._id, {

                googleSheetSynced: true,

                googleSheetSyncedAt: new Date(),

            });

        } catch (error) {

            console.error("[ApplicationService] Google Sheets sync failed:", error.message);

            await Application.findByIdAndUpdate(application._id, {

                googleSheetSynced: false,

                googleSheetSyncError: error.message,

            });

        }

        return application;

    }

}


export default new ApplicationService();
