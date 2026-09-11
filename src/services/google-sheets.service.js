import { google } from "googleapis";
import env from "../config/env.js";

class GoogleSheetsService {

    constructor() {

        this.spreadsheetId = env.googleSheets?.spreadsheetId || "";

        this.sheetName = env.googleSheets?.sheetName || "Sheet1";

        this.auth = null;

    }

    _parseServiceAccountKey(serviceAccountKey) {

        // First, try direct JSON.parse
        try {

            return JSON.parse(serviceAccountKey);

        } catch (firstError) {

            // If direct parse fails, try to fix common issues with
            // service account keys stored in .env files.
            // The most common issue is unescaped newlines inside the
            // private_key string value, which breaks JSON parsing.
            try {

                // Specifically target the private_key field to fix its newlines.
                // This is more reliable than trying to fix all quoted strings.
                const fixed = serviceAccountKey.replace(
                    /("private_key"\s*:\s*")([\s\S]*?)(")/g,
                    (match, prefix, keyContent, suffix) => {
                        // Escape newlines and other special chars inside the private key
                        const escapedKey = keyContent
                            .replace(/\\/g, "\\\\")
                            .replace(/\n/g, "\\n")
                            .replace(/\r/g, "\\r")
                            .replace(/\t/g, "\\t")
                            .replace(/"/g, "\\\"");
                        return `${prefix}${escapedKey}${suffix}`;
                    }
                );

                return JSON.parse(fixed);

            } catch (secondError) {

                // If both attempts fail, throw the original error
                throw firstError;

            }

        }

    }

    _validatePrivateKey(privateKey) {

        if (!privateKey || typeof privateKey !== "string") {

            throw new Error("Private key is missing or invalid.");

        }

        const trimmedKey = privateKey.trim();

        if (!trimmedKey.includes("-----BEGIN PRIVATE KEY-----")) {

            throw new Error(
                "Private key is missing the required PEM header '-----BEGIN PRIVATE KEY-----'. " +
                "Please ensure you are using the full service account JSON key from Google Cloud Console."
            );

        }

        if (!trimmedKey.includes("-----END PRIVATE KEY-----")) {

            throw new Error(
                "Private key is missing the required PEM footer '-----END PRIVATE KEY-----'. " +
                "Please ensure you are using the full service account JSON key from Google Cloud Console."
            );

        }

        // Check for common corruption signs
        if (trimmedKey.includes("\\n") || trimmedKey.includes("\\r")) {

            throw new Error(
                "Private key contains escaped newline sequences (\\n or \\r) instead of actual newlines. " +
                "The private key should contain actual newlines, not escaped sequences."
            );

        }

    }

    _getAuth() {

        if (this.auth) {

            return this.auth;

        }

        const serviceAccountKey = env.googleSheets?.serviceAccountKey;

        if (!serviceAccountKey) {

            throw new Error("Google Sheets service account key is not configured. Please set GOOGLE_SERVICE_ACCOUNT_KEY environment variable.");

        }

        try {

            const credentials = this._parseServiceAccountKey(serviceAccountKey);

            // Validate the private key format before using it
            this._validatePrivateKey(credentials.private_key);

            this.auth = new google.auth.GoogleAuth({

                credentials,

                scopes: ["https://www.googleapis.com/auth/spreadsheets"],

            });

            return this.auth;

        } catch (error) {

            if (error.message.includes("DECODER")) {

                throw new Error(
                    `Failed to decode Google service account private key: ${error.message}. ` +
                    `This usually means the private key format is invalid or corrupted. ` +
                    `Please re-download the service account JSON key from Google Cloud Console.`
                );

            }

            throw new Error(`Failed to parse Google service account key: ${error.message}`);

        }

    }

    async getClient() {

        const auth = this._getAuth();

        const authClient = await auth.getClient();

        return google.sheets({ version: "v4", auth: authClient });

    }

    async appendApplication(application) {

        if (!this.spreadsheetId) {

            throw new Error("Google Sheets spreadsheet ID is not configured. Please set GOOGLE_SPREADSHEET_ID environment variable.");

        }

        const sheets = await this.getClient();

        const timestamp = application.createdAt
            ? new Date(application.createdAt).toISOString()
            : new Date().toISOString();

        const row = [
            timestamp,
            application.fullName || "",
            application.email || "",
            application.phone || "",
            application.linkedinProfile || "",
            application.currentTitle || "",
            application.organisation || "",
            application.yearsExperience || "",
            application.primaryIndustry || "",
            application.primaryExpertise || "",
            application.otherExpertise || "",
            application.notableAchievement || "",
            application.businessChallenge || "",
            application.certifications || "",
            application.whyJoin || "",
            application.additionalInfo || "",
            application.consent || "",
            application.cv?.url || "",
        ];

        try {

            await sheets.spreadsheets.values.append({
                spreadsheetId: this.spreadsheetId,
                range: `${this.sheetName}!A1`,
                valueInputOption: "USER_ENTERED",
                requestBody: {
                    values: [row],
                },
            });

        } catch (error) {

            // Provide more helpful error messages for common issues
            if (error.message?.includes("Requested entity was not found") || error.code === 404) {

                throw new Error(
                    `Google Sheets spreadsheet not found. Please verify:\n` +
                    `1. The spreadsheet ID (${this.spreadsheetId}) is correct.\n` +
                    `2. The service account (${this.auth?.credentials?.client_email || "check GOOGLE_SERVICE_ACCOUNT_KEY"}) has been granted "Editor" access to the spreadsheet.\n` +
                    `3. The sheet name "${this.sheetName}" exists in the spreadsheet.`
                );

            }

            throw error;

        }

    }

}


export default new GoogleSheetsService();
