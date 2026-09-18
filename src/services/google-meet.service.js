import axios from "axios";

class GoogleMeetService {

    /**
     * Get a Meet space by ID.
     *
     * @param {string} accessToken - Valid Google OAuth access token
     * @param {string} spaceId - Meet space ID (from conferenceData.conferenceId)
     * @returns {Promise<Object>} Space resource
     */
    async getSpace(accessToken, spaceId) {
        if (!accessToken || !spaceId) {
            throw new Error("accessToken and spaceId are required");
        }

        const response = await axios.get(
            `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(spaceId)}`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        return response.data;
    }

    /**
     * List conference records for a Meet space.
     *
     * @param {string} accessToken - Valid Google OAuth access token
     * @param {string} spaceId - Meet space ID
     * @returns {Promise<Array>} Conference records
     */
    async listConferenceRecords(accessToken, spaceId) {
        if (!accessToken || !spaceId) {
            throw new Error("accessToken and spaceId are required");
        }

        const response = await axios.get(
            `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(spaceId)}/conferenceRecords`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        return response.data.conferenceRecords || [];
    }

    /**
     * Find the conference record that best matches a booking's scheduled window.
     *
     * Matching rule: the conference record with the greatest time overlap
     * against [scheduledStart, scheduledEnd] is selected.
     *
     * @param {string} accessToken - Valid Google OAuth access token
     * @param {string} spaceId - Meet space ID
     * @param {string} scheduledStart - Booking scheduled start (ISO 8601)
     * @param {string} scheduledEnd - Booking scheduled end (ISO 8601)
     * @returns {Promise<Object|null>} Matching conference record, or null
     */
    async findConferenceRecordForBooking(accessToken, spaceId, scheduledStart, scheduledEnd) {
        if (!accessToken || !spaceId || !scheduledStart || !scheduledEnd) {
            throw new Error("accessToken, spaceId, scheduledStart, and scheduledEnd are required");
        }

        const records = await this.listConferenceRecords(accessToken, spaceId);

        if (!records.length) {
            return null;
        }

        const bookingStart = new Date(scheduledStart).getTime();
        const bookingEnd = new Date(scheduledEnd).getTime();

        let bestMatch = null;
        let bestOverlap = 0;

        for (const record of records) {
            const recordStart = this._parseTimestamp(record.startTime);
            const recordEnd = this._parseTimestamp(record.endTime);

            if (!recordStart || !recordEnd) {
                continue;
            }

            const overlapStart = Math.max(recordStart, bookingStart);
            const overlapEnd = Math.min(recordEnd, bookingEnd);
            const overlap = overlapEnd - overlapStart;

            if (overlap > 0 && overlap > bestOverlap) {
                bestOverlap = overlap;
                bestMatch = record;
            }
        }

        return bestMatch;
    }

    /**
     * Retrieve normalized attendance for a conference record.
     *
     * Identifies the consultant by email and the client by 1:1 elimination,
     * then fetches participant sessions for both.
     *
     * @param {string} accessToken - Valid Google OAuth access token
     * @param {string} spaceId - Meet space ID
     * @param {string} conferenceRecordId - Conference record ID
     * @param {string} consultantGoogleEmail - Consultant's Google account email
     * @returns {Promise<Object>} Normalized attendance data
     */
    async getConferenceAttendance(accessToken, spaceId, conferenceRecordId, consultantGoogleEmail) {
        if (!accessToken || !spaceId || !conferenceRecordId || !consultantGoogleEmail) {
            throw new Error("accessToken, spaceId, conferenceRecordId, and consultantGoogleEmail are required");
        }

        const participants = await this.listParticipants(accessToken, spaceId, conferenceRecordId);

        if (!Array.isArray(participants)) {
            throw new Error(
                `Google Meet returned malformed participants data for conference record ${conferenceRecordId}: expected array, got ${typeof participants}`
            );
        }

        const normalizedParticipants = participants
            .map((p) => ({
                participantId: p.name?.split("/").pop() || p.id,
                email: typeof p.email === "string" ? p.email : "",
            }))
            .filter((p) => typeof p.email === "string" && p.email.length > 0);

        const consultantLower = consultantGoogleEmail.toLowerCase();
        const consultant = normalizedParticipants.find(
            (p) => typeof p.email === "string" && p.email.toLowerCase() === consultantLower
        );

        if (!consultant) {
            return {
                consultant: null,
                client: null,
            };
        }

        const others = normalizedParticipants.filter(
            (p) => p.email.toLowerCase() !== consultantLower
        );

        let client = null;
        if (others.length === 1) {
            client = others[0];
        }

        const consultantSessions = consultant
            ? await this.listParticipantSessions(accessToken, spaceId, conferenceRecordId, consultant.participantId)
            : [];

        const clientSessions = client
            ? await this.listParticipantSessions(accessToken, spaceId, conferenceRecordId, client.participantId)
            : [];

        return {
            consultant: {
                participantId: consultant.participantId,
                email: consultant.email,
                sessions: consultantSessions,
            },
            client: client
                ? {
                    participantId: client.participantId,
                    email: client.email,
                    sessions: clientSessions,
                }
                : null,
        };
    }

    /**
     * Parse an ISO 8601 timestamp to epoch milliseconds.
     * Returns null if the input is invalid.
     *
     * @param {string} timestamp - ISO 8601 timestamp
     * @returns {number|null} Epoch milliseconds or null
     */
    _parseTimestamp(timestamp) {
        if (!timestamp || typeof timestamp !== "string") {
            return null;
        }

        const parsed = new Date(timestamp);
        return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
    }

    /**
     * List participants for a conference record.
     *
     * @param {string} accessToken - Valid Google OAuth access token
     * @param {string} spaceId - Meet space ID
     * @param {string} conferenceRecordId - Conference record ID
     * @returns {Promise<Array>} Participants
     */
    async listParticipants(accessToken, spaceId, conferenceRecordId) {
        if (!accessToken || !spaceId || !conferenceRecordId) {
            throw new Error("accessToken, spaceId, and conferenceRecordId are required");
        }

        const response = await axios.get(
            `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(spaceId)}/conferenceRecords/${encodeURIComponent(conferenceRecordId)}/participants`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        return response.data.participants || [];
    }

    /**
     * List participant sessions for a participant in a conference record.
     *
     * @param {string} accessToken - Valid Google OAuth access token
     * @param {string} spaceId - Meet space ID
     * @param {string} conferenceRecordId - Conference record ID
     * @param {string} participantId - Participant ID
     * @returns {Promise<Array>} Participant sessions
     */
    async listParticipantSessions(accessToken, spaceId, conferenceRecordId, participantId) {
        if (!accessToken || !spaceId || !conferenceRecordId || !participantId) {
            throw new Error("accessToken, spaceId, conferenceRecordId, and participantId are required");
        }

        const response = await axios.get(
            `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(spaceId)}/conferenceRecords/${encodeURIComponent(conferenceRecordId)}/participants/${encodeURIComponent(participantId)}/participantSessions`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
        );

        return response.data.participantSessions || [];
    }
}

export default new GoogleMeetService();
