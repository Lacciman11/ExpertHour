/**
 * Google Meet Attendance Synchronization Service
 *
 * Converts verified Google Meet participant sessions into the
 * ConsultationSession attendanceEvents format.
 *
 * This service is database-independent and does not modify any models.
 * It only transforms Google Meet attendance data into the application's
 * attendance event structure.
 *
 * Does NOT calculate:
 *   - attendance duration (cumulative)
 *   - 80% threshold
 *   - session outcome
 *   - payout
 *   - refund
 *
 * Those calculations belong elsewhere.
 */

/**
 * Convert Google Meet participant sessions into ConsultationSession
 * attendanceEvents format.
 *
 * @param {Object} params
 * @param {Array} [params.consultantSessions] - Google participant sessions for the consultant
 * @param {Array} [params.clientSessions] - Google participant sessions for the client
 * @returns {Object} Normalized attendance events by participant role:
 *   { consultant: Array<attendanceEvent>, client: Array<attendanceEvent> }
 */
export function buildVerifiedAttendanceEvents({ consultantSessions, clientSessions }) {
    const events = {
        consultant: [],
        client: [],
    };

    const addSessions = (sessions, participant) => {
        if (!Array.isArray(sessions) || sessions.length === 0) {
            return;
        }

        for (const session of sessions) {
            if (!session || typeof session !== "object") {
                continue;
            }

            const startTime = session.startTime;
            const endTime = session.endTime;

            if (!startTime || typeof startTime !== "string") {
                continue;
            }

            const joinedAt = new Date(startTime);
            if (Number.isNaN(joinedAt.getTime())) {
                continue;
            }

            let leftAt = null;
            let durationSeconds = 0;

            if (endTime && typeof endTime === "string") {
                leftAt = new Date(endTime);
                if (!Number.isNaN(leftAt.getTime())) {
                    durationSeconds = Math.max(
                        0,
                        Math.floor((leftAt.getTime() - joinedAt.getTime()) / 1000)
                    );
                } else {
                    leftAt = null;
                }
            }

            events[participant].push({
                participant,
                joinedAt,
                leftAt,
                durationSeconds,
            });
        }
    };

    addSessions(consultantSessions, "consultant");
    addSessions(clientSessions, "client");

    return events;
}
