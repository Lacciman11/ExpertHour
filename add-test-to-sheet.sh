#!/usr/bin/env bash

set -e

echo "Adding test row to Google Sheets..."
echo

node --env-file=.env --input-type=module <<'NODE'

import { google } from "googleapis";

const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
const sheetName = process.env.GOOGLE_SHEET_NAME || "Sheet1";
const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

if (!spreadsheetId) {
    throw new Error("GOOGLE_SPREADSHEET_ID is missing");
}

if (!rawKey) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is missing");
}

const credentials = JSON.parse(rawKey);

const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
        "https://www.googleapis.com/auth/spreadsheets"
    ],
});

const authClient = await auth.getClient();

const sheets = google.sheets({
    version: "v4",
    auth: authClient,
});

const row = [
    new Date().toISOString(),
    "ExpertHour Test",
    "test@example.com",
    "+2340000000000",
    "https://linkedin.com",
    "Test User",
    "ExpertHour",
    "1-5 years",
    "Education",
    "",
    "Business Strategy",
    "",
    "",
    "",
    "Google Sheets diagnostic test",
    "Testing Google Sheets connection",
    "",
    "Testing",
    "Diagnostic row",
    "Yes",
    "https://example.com/test-cv.pdf",
    "DIAGNOSTIC-TEST"
];

const result = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
        values: [row],
    },
});

console.log("✅ ROW ADDED SUCCESSFULLY");
console.log(
    "Updated range:",
    result.data.updates?.updatedRange
);

NODE
