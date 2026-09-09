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

                // Replace literal newlines inside quoted strings with \n
                // This handles cases where the private_key was copy-pasted
                // with actual newlines instead of \n escape sequences.
                // Use [\s\S] instead of [^"\\] to match newlines inside strings.
                const fixed = serviceAccountKey.replace(
                    /("(?:[\s\S]*?)")/g,
                    (match) => match.replace(/\n/g, "\\n").replace(/\r/g, "\\r")
                );

                return JSON.parse(fixed);

            } catch (secondError) {

                // If both attempts fail, throw the original error
                throw firstError;

            }

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

            this.auth = new google.auth.GoogleAuth({

                credentials,

                scopes: ["https://www.googleapis.com/auth/spreadsheets"],

            });

            return this.auth;

        } catch (error) {

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
            application.primaryIndustryOther || "",
            application.primaryExpertise || "",
            application.primaryExpertiseOther || "",
            application.otherExpertise || "",
            application.otherExpertiseOther || "",
            application.notableAchievement || "",
            application.businessChallenge || "",
            application.certifications || "",
            application.whyJoin || "",
            application.additionalInfo || "",
            application.consent || "",
            application.cv?.url || "",
            application._id?.toString() || "",
        ];

        await sheets.spreadsheets.values.append({
            spreadsheetId: this.spreadsheetId,
            range: `${this.sheetName}!A1`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [row],
            },
        });

    }

}


export default new GoogleSheetsService();
