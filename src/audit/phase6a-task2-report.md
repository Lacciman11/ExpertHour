# Phase 6A Task 2 — Google Meet Integration Audit

## 1. OAuth Configuration

**OAuth authorization URL:** `https://accounts.google.com/o/oauth2/v2/auth`
**File:** `backend/src/services/google-calendar.service.js:10-25`

**Scope requested:**
```
https://www.googleapis.com/auth/calendar.events
```
**File:** `backend/src/services/google-calendar.service.js:13`

This is the **only** scope. It grants read/write access to calendar events but does **NOT** grant access to Google Meet attendance data, conference records, or participant sessions.

**Token storage:**
- Stored in `ConsultantProfile.googleCalendar` subdocument
- Fields: `{ accessToken, refreshToken, expiresAt, connected }`
- **File:** `backend/src/models/ConsultantProfile.js:176-193`

**Refresh token handling:**
- `_getValidAccessToken()` in `backend/src/services/google-calendar.service.js:83-107`
- Checks `profile.googleCalendar.expiresAt` against `Date.now()`
- If expired, calls `refreshAccessToken()` using the stored `refreshToken`
- Updates `accessToken` and `expiresAt` on the profile, then saves

**Google account identity stored:**
- **NO.** The `googleCalendar` subdocument stores only OAuth tokens (`accessToken`, `refreshToken`, `expiresAt`, `connected`). It does **NOT** store the Google account email, Google account ID, or any Google profile information.
- The `User` model (`backend/src/models/User.js`) has no Google identity fields.
- The `ConsultantProfile` model has no Google account email/ID field.

**Client-side Google OAuth:**
- The frontend (`experthour/src/pages/GoogleCalendarCallback.tsx`) receives the authorization code from Google's OAuth redirect and sends it to the backend via `consultantsApi.connectGoogleCalendar(code)`
- The backend exchanges the code for tokens via `googleCalendarService.exchangeCodeForTokens()` and stores them in the ConsultantProfile
- The client has **no** Google OAuth integration — only consultants can connect Google Calendar

**No Google account email/ID is stored for either participant.**

---

## 2. Google Calendar Integration

**File:** `backend/src/services/google-calendar.service.js` (319 lines)

### Calendar Event Creation

**Method:** `createEvent()` at `backend/src/services/google-calendar.service.js:109-159`

- Creates a Google Calendar event via `POST https://www.googleapis.com/calendar/v3/calendars/primary/events`
- Uses `conferenceData.createRequest` with `conferenceSolutionKey: { type: "hangoutsMeet" }` to auto-create a Google Meet conference
- The event contains: `summary`, `description`, `start` (dateTime + timeZone), `end` (dateTime + timeZone), `conferenceData`
- **The event does NOT include an `attendees` field** — no consultant or client email addresses are added to the event

**Which Google account creates the event:**
- The **consultant's** Google account. The method takes `consultantId` as a parameter, looks up `ConsultantProfile.findOne({ userId: consultantId })`, and uses the consultant's stored OAuth tokens.

**Where the resulting Meet URL is stored:**
- On `Booking.meetingLink` (not on ConsultationSession)
- In `reconcilePayment()` at `backend/src/services/payment.service.js:1206-1219`, the Meet link is obtained from `googleCalendarService.createEventAndGetMeetLink()` and stored via `booking.meetingLink = meetingLink; await booking.save()`

**Google event ID stored:**
- **NO.** The `updateEvent()` and `deleteEvent()` methods search for the event by summary text: `q: "ExpertHour Consultation - Booking #${bookingId}"` (lines 178, 276). The Google event ID is never persisted.

**Conference ID or Meet code stored:**
- **NO.** Only the `hangoutLink` URL is stored on `Booking.meetingLink`. No `conferenceData.conferenceId` or Meet code is persisted.

### Calendar Event Lifecycle

| Operation | Method | File | Behavior |
|-----------|--------|------|----------|
| Create | `createEvent()` | `google-calendar.service.js:109` | Creates event with Meet conference; returns `hangoutLink` |
| Update | `updateEvent()` | `google-calendar.service.js:161` | Searches by summary text, updates start/end times; returns `hangoutLink` |
| Delete | `deleteEvent()` | `google-calendar.service.js:257` | Searches by summary text, deletes event; swallows errors |
| Cancel | (via `deleteEvent`) | `booking.service.js:536-543` | Called during booking cancellation if `booking.meetingLink` exists |
| Reschedule | (via `updateEvent`) | Not called from any service | `updateEventAndGetMeetLink` exists but is **never called** anywhere in the codebase |

**Finding:** `updateEventAndGetMeetLink()` at `google-calendar.service.js:239-255` is defined but **never called** from any service or controller. Rescheduling is not implemented.

---

## 3. Google Meet Integration

**No Google Meet API integration exists.**

**Evidence:**

1. **`package.json`** (`backend/package.json:18-34`): The `googleapis` npm package is **NOT** installed. The only HTTP client is `axios`.

2. **Google Calendar service** (`backend/src/services/google-calendar.service.js`): All API calls use raw `axios` to the Google Calendar REST API (`https://www.googleapis.com/calendar/v3/...`). No Google Meet REST API endpoints are called.

3. **No Meet-specific API calls:** The service never calls:
   - `GET /v1/conferenceRecords` (Conference Records API)
   - `GET /v1/conferenceRecords/{conferenceRecord}/participants` (Participants API)
   - `GET /v1/conferenceRecords/{conferenceRecord}/participants/{participant}/participantSessions` (Participant Sessions API)
   - `GET /v1/conferenceRecords/{conferenceRecord}/attendance` (Attendance API)

4. **No conference ID stored:** Without a `conferenceId` or `conferenceRecordName`, the Meet API cannot be queried even if the scope were added.

---

## 4. Attendance API Capability

### Current OAuth Scope

```
https://www.googleapis.com/auth/calendar.events
```

This scope provides:
- Read/write access to calendar events
- Ability to create events with Meet conferences
- **Does NOT provide** access to:
  - Conference records
  - Participant sessions
  - Attendance reports
  - Participant join/leave timestamps

### Required Scopes for Attendance Data

The Google Meet REST API requires additional scopes:

| API | Required Scope |
|-----|---------------|
| Conference Records | `https://www.googleapis.com/auth/meetings.conferenceRecords` |
| Participant Sessions | `https://www.googleapis.com/auth/meetings.participantSessions` |
| Attendance Reports | `https://www.googleapis.com/auth/meetings.meetingAttendance` |

**Note:** Some of these scopes require Google Workspace (formerly G Suite) admin privileges and may not be available to regular consumer Google accounts. The `meetings.meetingAttendance` scope specifically requires Google Workspace.

### What the Current Implementation Has Access To

- **Google Meet API:** NO
- **Google Meet REST endpoints:** NO
- **Conference records:** NO
- **Participant sessions:** NO
- **Participant join timestamps:** NO
- **Participant leave timestamps:** NO
- **Attendance reports:** NO
- **Meeting/conference identifiers:** NO (only the `hangoutLink` URL is stored)

### External API Verification Item

Whether the Google Meet REST API is available for this Google Cloud project cannot be determined from the repository alone. This requires:
1. Checking the Google Cloud Console for enabled APIs
2. Verifying the OAuth consent screen configuration
3. Confirming whether the project has Google Workspace admin privileges

---

## 5. Participant Identity Mapping

### Consultant

| Identity | Stored? | Location |
|----------|---------|----------|
| ExpertHour User ID | Yes | `Booking.consultantId`, `ConsultationSession.consultantId` |
| ExpertHour email | Yes | `User.email` |
| Google account email | **NO** | Not stored anywhere |
| Google OAuth account identity | **NO** | Only tokens stored, not account email/ID |

### Client

| Identity | Stored? | Location |
|----------|---------|----------|
| ExpertHour User ID | Yes | `Booking.clientId`, `ConsultationSession.clientId` |
| ExpertHour email | Yes | `User.email` |
| Google account email | **NO** | Not stored anywhere |
| Google OAuth account identity | **NO** | Client has no Google OAuth integration |

### Can Google Meet Participant Identity Be Mapped?

**NO.** The mapping cannot be reliably established because:

1. **Consultant's Google account email is not stored.** The `googleCalendar` subdocument only stores OAuth tokens. There is no field for the Google account email or Google account ID. Even if the Meet API were called, there would be no way to match a Google Meet participant to the ExpertHour consultant.

2. **The client has no Google OAuth integration.** The client cannot authenticate with Google, so there is no Google identity to match. The client would join the Meet as a guest (or via the shared link), and their identity in Google Meet would be unknown.

3. **The Google Calendar event has no `attendees` field.** The `createEvent()` method does not add attendees to the event. Even if attendee emails were added, the consultant's Google email is not known (only their ExpertHour email is stored).

4. **No Google profile information is retrieved.** The OAuth flow only requests `calendar.events` scope and only stores tokens. No `userinfo` endpoint is called, and no Google profile data (email, name, ID) is stored.

---

## 6. Booking → Session → Meet Linkage

### Current Linkage Chain

```
Booking
   ↓ (bookingId, unique)
ConsultationSession
   ↓ (NO direct link — session has no Google event ID or conference ID)
Google Calendar Event
   ↓ (hangoutLink URL only — no event ID or conference ID stored)
Google Meet Conference
   ↓ (NO attendance retrieval mechanism)
Attendance Records
```

### Identifiers Stored

| Entity | Identifier | Stored? | Location |
|--------|-----------|---------|----------|
| Booking | Booking ID | Yes | `Booking._id` |
| Booking | Meeting link (hangoutLink URL) | Yes | `Booking.meetingLink` |
| Booking | Google event ID | **NO** | Not stored |
| Booking | Meet conference ID | **NO** | Not stored |
| Booking | Meet code | **NO** | Not stored |
| ConsultationSession | Session ID | Yes | `ConsultationSession._id` |
| ConsultationSession | Booking ID | Yes | `ConsultationSession.bookingId` (unique) |
| ConsultationSession | Google event ID | **NO** | Not stored |
| ConsultationSession | Meet conference ID | **NO** | Not stored |
| ConsultationSession | Meet URL | **NO** | Not stored (only on Booking) |

### Correlation After Meeting

**Cannot be correlated.** After a meeting ends:
- There is no Google event ID to look up the event
- There is no conference ID to query the Meet API
- There is no stored Meet URL on the ConsultationSession (only on Booking.meetingLink)
- Even if the Meet URL were available, the Meet API requires a `conferenceRecordName` (not a URL) to query attendance

---

## 7. Attendance Retrieval

**No attendance retrieval mechanism currently exists.**

Search results for webhook, Pub/Sub, polling, reconciliation, conference records, participant sessions, and attendance reports:

- **No webhook:** No Google Meet webhook or Pub/Sub subscription exists. The only webhook is the Paystack payment webhook (`backend/src/routes/payment.routes.js:71`).
- **No polling:** No background worker polls Google Meet for attendance data. The only polling workers are `PaymentReconciliationService` and `EarningEligibilityService`, neither of which interacts with Google APIs.
- **No reconciliation:** No reconciliation logic exists for Google Meet attendance data.
- **No conference records API calls:** None found.
- **No participant sessions API calls:** None found.
- **No attendance reports API calls:** None found.

---

## 8. Failure Scenarios

| # | Scenario | Current Behavior |
|---|----------|-----------------|
| 1 | Google Meet link creation fails | `createEventAndGetMeetLink()` catches the error and returns `null` (`google-calendar.service.js:232-236`). `booking.meetingLink` remains empty. The `generateMeetingLink` method in `booking.service.js:750` falls back to a local URL (`https://experthour.onrender.com/meeting/${booking._id}`). |
| 2 | Calendar event creation succeeds but Meet creation fails | The `hangoutLink` from the Google response would be `undefined`. The service returns `response.data.hangoutLink` which could be `undefined`. No error is thrown. |
| 3 | Meeting occurs but attendance data is delayed | No mechanism to retrieve attendance data at all. |
| 4 | Attendance data is unavailable | No mechanism to retrieve attendance data at all. |
| 5 | Google returns an unknown participant | No mechanism to retrieve participant data at all. |
| 6 | Consultant's Google email differs from ExpertHour email | Cannot be determined — Google account email is not stored. Even if it were, there is no matching logic. |
| 7 | Client has no Google account | The client has no Google OAuth integration. The client would join the Meet link as a guest, and their identity would be unknown. |
| 8 | Consultant changes Google account | The old OAuth tokens would be invalid. `_getValidAccessToken()` would fail to refresh. `createEvent()` would throw. The error is caught in `createEventAndGetMeetLink()` and returns `null`. The consultant would need to reconnect via the Google Calendar OAuth flow. |
| 9 | Calendar authorization expires/revokes | `_getValidAccessToken()` would fail to refresh (no valid `refreshToken`). `createEvent()` would throw "Consultant has not connected Google Calendar" or "No refresh token available." The error is caught and `null` is returned. |
| 10 | Meeting is created under the wrong Google account | Cannot be determined — the Google account email is not stored, so there is no way to verify which account was used. |

---

## 9. Capability Assessment

| Requirement | YES / PARTIALLY / NO | Evidence |
|---|---|---|
| Verify consultant join | **NO** | No Google Meet API integration; no attendance data retrieval; consultant's Google account email not stored |
| Verify client join | **NO** | No Google Meet API integration; client has no Google OAuth; no attendance data retrieval |
| Verify leave time | **NO** | No attendance data retrieval mechanism exists |
| Handle leave/rejoin | **NO** | No attendance data retrieval; `attendanceEvents` array never populated |
| Identify consultant | **NO** | Google account email/ID not stored; event has no `attendees` field |
| Identify client | **NO** | Client has no Google OAuth; event has no `attendees` field |
| 15-min consultant grace | **NO** | No attendance data to determine join time; no grace period logic in any service |
| 20-min client wait | **NO** | No attendance data to determine join time; no waiting period logic in any service |
| 80% attendance threshold | **NO** | No attendance duration calculation; `clientAttendanceMet`/`consultantAttendanceMet` flags never set |

---

## 10. Findings

### FINDING-GM-01 — CRITICAL: No Google Meet API integration

- **Severity:** CRITICAL
- **Location:** `backend/package.json:18-34` (no `googleapis` package); `backend/src/services/google-calendar.service.js` (only Calendar REST API calls via axios)
- **Current behavior:** The application uses raw `axios` calls to the Google Calendar REST API. No Google Meet REST API endpoints are called. No conference records, participant sessions, or attendance reports are retrieved.
- **Expected behavior:** The application should use the Google Meet REST API to retrieve attendance data (participant join/leave timestamps, attendance reports).
- **Security impact:** Cannot verify participant identity or attendance
- **Financial impact:** Cannot determine no-shows, cannot enforce grace periods, cannot calculate 80% threshold
- **Required API capability:** Google Meet REST API with `meetings.conferenceRecords`, `meetings.participantSessions`, and/or `meetings.meetingAttendance` scopes
- **Required schema changes:** Yes — need to store Google event ID, conference ID, and conference record name
- **Recommended direction:** Install `googleapis` package, add Meet API scopes, store conference identifiers, implement attendance retrieval

### FINDING-GM-02 — CRITICAL: Google account identity not stored for participants

- **Severity:** CRITICAL
- **Location:** `backend/src/models/ConsultantProfile.js:176-193` (googleCalendar subdocument has no email/ID fields); `backend/src/models/User.js` (no Google identity fields)
- **Current behavior:** The `googleCalendar` subdocument stores only `{ accessToken, refreshToken, expiresAt, connected }`. No Google account email, Google account ID, or Google profile information is stored. The client has no Google OAuth integration at all.
- **Expected behavior:** The consultant's Google account email/ID should be stored during the OAuth flow. The client should also have a Google identity (or an alternative identity verification mechanism).
- **Security impact:** Cannot verify which Google Meet participant is the ExpertHour consultant or client
- **Financial impact:** Cannot determine who actually attended the meeting
- **Required API capability:** Google OAuth `userinfo` endpoint or `openid` scope
- **Required schema changes:** Yes — add `googleEmail` and/or `googleAccountId` to User or ConsultantProfile
- **Recommended direction:** Store Google account identity during OAuth flow; add `attendees` to calendar events

### FINDING-GM-03 — CRITICAL: Calendar event has no attendees

- **Severity:** CRITICAL
- **Location:** `backend/src/services/google-calendar.service.js:121-140` (createEvent — no `attendees` field in event object)
- **Current behavior:** The `createEvent()` method creates a calendar event with `summary`, `description`, `start`, `end`, and `conferenceData`, but does **NOT** include an `attendees` field. No consultant or client email addresses are added to the event.
- **Expected behavior:** The event should include `attendees` with the consultant's and client's email addresses, so Google can send invitations and track participation.
- **Security impact:** Cannot verify participant identity through calendar event attendees
- **Financial impact:** Cannot determine attendance
- **Required API capability:** `https://www.googleapis.com/auth/calendar.events` (already has this scope)
- **Required schema changes:** No (but requires Google account emails to be stored — see GM-02)
- **Recommended direction:** Add `attendees` field to event creation with consultant and client emails

### FINDING-GM-04 — HIGH: No Google event ID or conference ID stored

- **Severity:** HIGH
- **Location:** `backend/src/services/google-calendar.service.js:109-159` (createEvent returns only `hangoutLink`); `backend/src/services/payment.service.js:1206-1219` (stores only `hangoutLink` on Booking.meetingLink)
- **Current behavior:** Only the `hangoutLink` URL is stored on `Booking.meetingLink`. The Google Calendar event ID, conference ID, and conference record name are never persisted. The `updateEvent()` and `deleteEvent()` methods search for events by summary text, which is fragile.
- **Expected behavior:** The Google event ID and conference ID should be stored so that the event can be looked up directly and Meet attendance data can be queried.
- **Security impact:** Cannot reliably look up events or query attendance
- **Financial impact:** Cannot retrieve attendance data for earning determination
- **Required API capability:** Google Calendar API (already has scope)
- **Required schema changes:** Yes — add `googleEventId`, `googleConferenceId` to Booking or ConsultationSession
- **Recommended direction:** Store Google event ID and conference ID during event creation

### FINDING-GM-05 — HIGH: OAuth scope insufficient for attendance data

- **Severity:** HIGH
- **Location:** `backend/src/services/google-calendar.service.js:13` (scope: `https://www.googleapis.com/auth/calendar.events`)
- **Current behavior:** The only OAuth scope requested is `calendar.events`, which does not grant access to Google Meet attendance data. The Google Meet REST API requires additional scopes (`meetings.conferenceRecords`, `meetings.participantSessions`, `meetings.meetingAttendance`).
- **Expected behavior:** Additional Meet API scopes should be requested to enable attendance data retrieval.
- **Security impact:** Cannot access attendance data
- **Financial impact:** Cannot verify attendance for earning determination
- **Required API capability:** Google Meet REST API scopes
- **Required schema changes:** No
- **Recommended direction:** Add Meet API scopes to OAuth flow (requires Google Cloud Console configuration)

### FINDING-GM-06 — MEDIUM: `updateEventAndGetMeetLink` is never called

- **Severity:** MEDIUM
- **Location:** `backend/src/services/google-calendar.service.js:239-255` (defined but never called)
- **Current behavior:** The `updateEventAndGetMeetLink()` method exists but is never called from any service or controller. Rescheduling a booking does not update the Google Calendar event.
- **Expected behavior:** This method should be called when a booking is rescheduled.
- **Security impact:** None
- **Financial impact:** Low — rescheduling doesn't affect earnings directly
- **Required API capability:** None
- **Required schema changes:** No
- **Recommended direction:** Call `updateEventAndGetMeetLink()` during booking rescheduling

### FINDING-GM-07 — MEDIUM: Meeting link fallback is a local URL, not a Google Meet link

- **Severity:** MEDIUM
- **Location:** `backend/src/services/booking.service.js:750` (`generateMeetingLink` creates `https://experthour.onrender.com/meeting/${booking._id}`)
- **Current behavior:** When a consultant has not connected Google Calendar, the `generateMeetingLink` method creates a local URL that does not connect to any video meeting service. The actual Google Meet link is only created during payment reconciliation.
- **Expected behavior:** The meeting link should always be a Google Meet link, or the system should clearly indicate that no meeting is available.
- **Security impact:** Users may be directed to a non-functional meeting page
- **Financial impact:** Low — doesn't directly affect earnings
- **Required API capability:** None
- **Required schema changes:** No
- **Recommended direction:** Ensure Google Meet link is always generated when payment succeeds

### FINDING-GM-08 — LOW: No Google Meet attendance data reconciliation worker

- **Severity:** LOW
- **Location:** `backend/src/services/` (no attendance reconciliation service exists)
- **Current behavior:** There is no background worker that retrieves Google Meet attendance data after a meeting ends. The only background workers are `PaymentReconciliationService`, `EarningEligibilityService`, `RefundReconciliationService`, and `PayoutProcessingService`.
- **Expected behavior:** A worker should retrieve attendance data after meetings end and update session attendance records.
- **Security impact:** None
- **Financial impact:** Cannot automate attendance-based earning determination
- **Required API capability:** Google Meet REST API
- **Required schema changes:** No
- **Recommended direction:** Implement an attendance reconciliation worker

---

## 11. Recommended Architecture Direction

1. **Store Google account identity:** During the OAuth flow, retrieve and store the consultant's Google account email and Google account ID. Add `googleEmail` and `googleAccountId` fields to the User or ConsultantProfile model.

2. **Add attendees to calendar events:** Include the consultant's and client's email addresses in the `attendees` field of Google Calendar events. This enables Google to send invitations and track participation.

3. **Store Google event ID and conference ID:** Persist the Google Calendar event ID and the Meet conference ID on the Booking or ConsultationSession model. This enables direct lookup of events and Meet conferences.

4. **Add Google Meet API scopes:** Request additional OAuth scopes (`meetings.conferenceRecords`, `meetings.participantSessions`, `meetings.meetingAttendance`) to enable attendance data retrieval. Note: some of these scopes require Google Workspace admin privileges.

5. **Install `googleapis` package:** Use the official Google API client library instead of raw axios calls for more reliable API interaction and built-in token management.

6. **Implement attendance retrieval:** Create a background worker that queries the Google Meet API for attendance data after meetings end, using the stored conference ID.

7. **Map Google Meet participants to ExpertHour users:** Use the stored Google account email/ID to match Google Meet participants to ExpertHour users. For clients without Google accounts, implement an alternative identity verification mechanism (e.g., meeting PIN, or require Google account for meeting access).

---

## 12. Recommended Next Task

**Inspect the ConsultantEarning model and service in depth** (`backend/src/models/ConsultantEarning.js` and `backend/src/services/consultant-earning.service.js`).

Specifically determine:
1. The exact earning status state machine and valid transitions.
2. How the `determineEarningFromSessionOutcome()` function maps session outcomes to financial amounts.
3. How the 24-hour eligibility mechanism interacts with earning creation.
4. How refunds and earnings remain consistent (the refund-reconciliation pipeline).
5. Whether duplicate earning creation is fully prevented.

This is the next critical area because the earning pipeline is the financial consequence of session outcomes, and understanding it is essential before designing the session outcome determination logic.
