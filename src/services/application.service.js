import mongoose from "mongoose";

import cloudinaryService from "./cloudinary.service.js";

import googleSheetsService from "./google-sheets.service.js";

import Application from "../models/Application.js";

import ApiError from "../utils/ApiError.js";

class ApplicationService {

    async createApplication(data, cvFiles = [], qualificationFiles = []) {

        const { email } = data;

        const existingApplication = await Application.findOne({ email });

        if (existingApplication) {

            throw new ApiError(409, "An application with this email already exists");

        }

        const requiredFields = ["fullName", "email", "phone", "linkedinProfile", "currentTitle", "yearsExperience", "primaryIndustry", "primaryExpertise", "notableAchievement", "businessChallenge", "whyJoin", "consent"];

        for (const field of requiredFields) {

            if (!data[field] || (Array.isArray(data[field]) && data[field].length === 0)) {

                throw new ApiError(400, `${field} is required`);

            }

        }

        if (data.consent !== "Yes") {

            throw new ApiError(400, "You must provide consent to submit the application");

        }

        const applicationData = {

            fullName: data.fullName,

            email: data.email,

            phone: data.phone,

            linkedinProfile: data.linkedinProfile,

            currentTitle: data.currentTitle,

            organisation: data.organisation || "",

            yearsExperience: data.yearsExperience,

            primaryIndustry: Array.isArray(data.primaryIndustry) ? data.primaryIndustry : [data.primaryIndustry],

            primaryExpertise: data.primaryExpertise,

            otherExpertise: Array.isArray(data.otherExpertise) ? data.otherExpertise : [],

            notableAchievement: data.notableAchievement,

            businessChallenge: data.businessChallenge,

            certifications: data.certifications || "",

            industryContributions: data.industryContributions || "",

            projectsConsultingEvidence: data.projectsConsultingEvidence || "",

            whyJoin: data.whyJoin,

            additionalInfo: data.additionalInfo || "",

            consent: data.consent,

        };

        if (cvFiles && cvFiles.length > 0) {

            const cvUploadPromises = cvFiles.map((file) => cloudinaryService.uploadCV(file));

            const cvResults = await Promise.all(cvUploadPromises);

            applicationData.cvs = cvResults.map((result, index) => ({

                url: result.url,

                publicId: result.publicId,

                originalName: cvFiles[index].originalname,

                mimeType: cvFiles[index].mimetype,

            }));

            if (cvResults.length > 0) {

                applicationData.cv = {

                    url: cvResults[0].url,

                    publicId: cvResults[0].publicId,

                    originalName: cvFiles[0].originalname,

                    mimeType: cvFiles[0].mimetype,

                };

            }

        }

        if (qualificationFiles && qualificationFiles.length > 0) {

            const qualificationUploadPromises = qualificationFiles.map((file) => cloudinaryService.uploadQualification(file));

            const qualificationResults = await Promise.all(qualificationUploadPromises);

            applicationData.qualifications = qualificationResults.map((result, index) => ({

                url: result.url,

                publicId: result.publicId,

                originalName: qualificationFiles[index].originalname,

                mimeType: qualificationFiles[index].mimetype,

            }));

        }

        const application = await Application.create(applicationData);

        // Attempt to sync to Google Sheets (non-critical)
        try {

            await googleSheetsService.appendApplication(application);

            await Application.findByIdAndUpdate(application._id, {

                googleSheetSynced: true,

                googleSheetSyncedAt: new Date(),

                googleSheetSyncError: "",

            });

        } catch (error) {

            console.error("[ApplicationService] Google Sheets sync failed");

            console.error("Message:", error.message);

            console.error("Code:", error.code);

            console.error("Status:", error.response?.status);

            console.error("Google response:", error.response?.data);

            await Application.findByIdAndUpdate(application._id, {

                googleSheetSynced: false,

                googleSheetSyncedAt: null,

                googleSheetSyncError: error.message,

            });

        }

        const updatedApplication = await Application.findById(application._id);

        return updatedApplication;

    }

    async getApplications(filters = {}) {

        const { status, page = 1, limit = 10 } = filters;

        const query = {};

        if (status) {

            query.status = status;

        }

        const applications = await Application.find(query)

            .sort({ createdAt: -1 })

            .skip((page - 1) * limit)

            .limit(Number(limit));

        const total = await Application.countDocuments(query);

        return { applications, total, page: Number(page), limit: Number(limit) };

    }

    async getApplicationById(id) {

        const application = await Application.findById(id);

        if (!application) {

            throw new ApiError(404, "Application not found");

        }

        return application;

    }

    async updateApplicationStatus(id, status) {

        const application = await Application.findByIdAndUpdate(id, { status }, { new: true });

        if (!application) {

            throw new ApiError(404, "Application not found");

        }

        return application;

    }

}

const applicationService = new ApplicationService();

export default applicationService;
