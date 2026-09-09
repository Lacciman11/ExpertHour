# Phase 6A Task 1 Report

## 1. ConsultationSession Model

**File:** `backend/src/models/ConsultationSession.js` (137 lines)

### Schema Fields

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `bookingId` | ObjectId → Booking | Yes | — | **Unique** constraint |
| `consultantId` | ObjectId → User | Yes | — | Denormalized from booking |
| `clientId` | ObjectId → User | Yes | — | Denormalized from booking |
| `notes` | String | No | `""` | Max 2000 chars |
| `recordingUrl` | String | No | `""` | |
| `attendanceStatus` | String (enum) | No | `"not_started"` | See below |
| `startedAt` | Date | No | `null` | |
| `endedAt` | Date | No | `null` | |
| `clientJoinedAt` | Date | No | `null` | |
| `consultantJoinedAt` | Date | No | `null` | |
| `attendanceEvents` | Array | No | `[]` | Subdocs: `{participant, joinedAt, leftAt, durationSeconds}` |
| `clientAttendanceDuration` | Number | No | `0` | Seconds, min 0 |
| `consultantAttendanceDuration` | Number | No | `0` | Seconds, min 0 |
| `clientAttendanceMet` | Boolean | No | `null` | null = undetermined |
| `consultantAttendanceMet` | Boolean | No | `null` | null = undetermined |
| `createdAt` | Date | — | — | `timestamps: true` |
| `updatedAt` | Date | — | — | `timestamps: true` |

### Status Values (attendanceStatus enum)

```
"not_started"
"in_progress"
"completed"
"no_show_client"
"no_show_consultant"
"late_client"
"late_consultant"
```

### Indexes

- `{ consultantId: 1 }` — non-unique
- `{ clientId: 1 }` — non-unique
- `{ bookingId: 1 }` — **unique** (enforced by schema `unique: true`)

### Hooks / Methods

- **No pre-save hooks**
- **No post-save hooks**
- **No instance methods**
- **No static methods**
- **No virtuals**
- `versionKey: false` (no `__v` field)

### Validation

- Schema-level: `min` validators on duration fields (≥ 0)
- No custom validators for state transitions
- No validation that `endedAt` ≥ `startedAt`
- No validation that `attendanceEvents` entries are consistent (e.g., no overlapping join/leave periods)
- No validation that `clientAttendanceMet`/`consultantAttendanceMet` are only set when `attendanceStatus` is terminal

---

## 2. Session Creation

**Flow:** `Booking → ConsultationSession`

### Actual Flow

The ConsultationSession is **NOT** created automatically when:
- A booking is created (`booking.service.js:283-193`)
- A booking is confirmed (`booking.service.js:385-418`)
- Payment succeeds (`payment.service.js:1137-1162`)
- A Google Calendar event is created (`google-calendar.service.js:109-159`)

The ConsultationSession is created **lazily** — only when a client or consultant calls:

```
PUT /api/v1/sessions/booking/:bookingId
```

**Service function:** `ConsultationSessionService.createOrUpdateSession()`
**File:** `backend/src/services/consultation-session.service.js:10`

**Controller:** `createOrUpdateSession`
**File:** `backend/src/controllers/consultation-session.controller.js:9`

**Route:** `backend/src/routes/consultation-session.routes.js:30-33`

### Creation Logic

```javascript
// consultation-session.service.js:30-44
let session = await ConsultationSession.findOne({ bookingId });
if (!session) {
    session = await ConsultationSession.create({
        bookingId,
        consultantId: booking.consultantId,
        clientId: booking.clientId,
        ...data,  // only notes and recordingUrl from controller
    });
}
```

### Required Conditions

1. Booking must exist (`Booking.findById(bookingId)`)
2. `userId` must match `booking.consultantId` OR `booking.clientId` (ownership check)
3. Request body must contain `notes` and/or `recordingUrl` (controller destructures only these)

### Duplicate Prevention

- **Non-atomic check-then-create:** `findOne` then `create` — a race condition exists where two concurrent requests can both find no session and both attempt to create. The unique index on `bookingId` will reject the second, but the error is **not caught** — it will propagate as a 500 error.
- **No transaction wrapping** around the create operation.

### Idempotency

- The `findOne` check provides idempotency for sequential requests, but **not** for concurrent requests.

---

## 3. Session Mutations

All mutations go through `ConsultationSessionService` (`backend/src/services/consultation-session.service.js`).

| Function | File | Fields Changed | Authorization | Atomic? |
|----------|------|----------------|---------------|---------|
| `createOrUpdateSession` | `consultation-session.service.js:10` | `notes`, `recordingUrl` (on create: also `bookingId`, `consultantId`, `clientId`) | Must be booking's consultant or client (checked via `booking.consultantId`/`booking.clientId`) | **No** — `findOne` + `create`/`findByIdAndUpdate` are separate operations |
| `updateAttendance` | `consultation-session.service.js:89` | `attendanceStatus`, `startedAt` (on `in_progress`), `endedAt` (on `completed`), `clientJoinedAt` (if client), `consultantJoinedAt` (if consultant) | Must be booking's consultant or client | **No** — `findOne` + `findByIdAndUpdate` are separate; earning creation is a separate call after the update |
| `addRecordingUrl` | `consultation-session.service.js:202` | `recordingUrl` | Must be booking's consultant only | **No** — `findOne` + `save` are separate |

### Critical Observation: `updateAttendance` Trust Boundary

The `updateAttendance` method accepts an `attendanceStatus` string directly from the client request body:

```javascript
// consultation-session.controller.js:61-67
export const updateAttendance = asyncHandler(async (req, res) => {
    const { bookingId } = req.params;
    const { attendanceStatus } = req.body;
    const session = await ConsultationSessionService.updateAttendance(bookingId, req.user._id, attendanceStatus);
```

**Any authenticated user who is the booking's client or consultant can set ANY attendanceStatus value**, including:
- `no_show_client` (set by consultant to claim client didn't show)
- `no_show_consultant` (set by client to claim consultant didn't show)
- `completed` (set by either party)
- `late_client` / `late_consultant`

There is **no server-side verification** of:
- Whether the participant actually joined the meeting
- Whether the participant was actually late
- Whether the participant actually left
- Whether the session duration was met

### No State Transition Validation

The `updateAttendance` method does **not** validate state transitions. A session can go from:
- `not_started` → `completed` (skipping `in_progress`)
- `in_progress` → `no_show_consultant` (skipping `completed`)
- `completed` → `no_show_client` (reversing a terminal state)
- Any status → any other status

---

## 4. Attendance Capability

### What the Model Can Represent

The schema has fields that **appear** to support attendance tracking:
- `attendanceEvents` array (join/leave history per participant)
- `clientAttendanceDuration` / `consultantAttendanceDuration` (cumulative seconds)
- `clientAttendanceMet` / `consultantAttendanceMet` (80% threshold flags)
- `clientJoinedAt` / `consultantJoinedAt` (first join timestamps)
- `startedAt` / `endedAt` (session start/end)

### What Is Actually Implemented

**NONE of the attendance tracking fields are ever populated or calculated.**

Evidence:

1. `attendanceEvents` — **never written to** by any service. The `updateAttendance` method does not push to this array.
2. `clientAttendanceDuration` / `consultantAttendanceDuration` — **never calculated**. No service computes these from `attendanceEvents` or from join/leave timestamps.
3. `clientAttendanceMet` / `consultantAttendanceMet` — **never set**. They remain at their default `null` forever.
4. `clientJoinedAt` / `consultantJoinedAt` — set only when `attendanceStatus === "in_progress"` and the requesting user is the client/consultant respectively. But this is set by the **client themselves** — there is no verification they actually joined.
5. `startedAt` — set when `attendanceStatus === "in_progress"`.
6. `endedAt` — set when `attendanceStatus === "completed"`.

### Can the System Calculate Actual Attendance Duration?

**No.** The system cannot reliably calculate actual attendance duration for either participant because:

- There is no join/leave event tracking (the `attendanceEvents` array is never populated)
- There is no integration with Google Meet to obtain real attendance data
- The `clientJoinedAt`/`consultantJoinedAt` fields are set by the participant themselves with no verification
- There is no leave tracking at all — `leftAt` in `attendanceEvents` is never set
- There is no grace period logic (15-minute consultant grace, 20-minute customer wait)
- There is no 80% threshold calculation

### Leave/Rejoin

**Not implemented.** There is no mechanism to record when a participant leaves or rejoins. The `attendanceEvents` array exists in the schema but is never used.

---

## 5. Session Outcome

### How Terminal Outcomes Are Currently Determined

**File:** `backend/src/services/consultation-session.service.js:172-200`

```javascript
_determineSessionOutcome(session, attendanceStatus) {
    if (attendanceStatus === "no_show_client") {
        return SESSION_OUTCOME.CUSTOMER_NO_SHOW;
    }
    if (attendanceStatus === "no_show_consultant") {
        return SESSION_OUTCOME.CONSULTANT_NO_SHOW;
    }
    // For completed sessions, use attendance met flags when available
    const clientMet = session.clientAttendanceMet;
    const consultantMet = session.consultantAttendanceMet;
    if (clientMet && consultantMet) {
        return SESSION_OUTCOME.COMPLETED;
    }
    if (consultantMet && !clientMet) {
        return SESSION_OUTCOME.CUSTOMER_INSUFFICIENT;
    }
    if (clientMet && !consultantMet) {
        return SESSION_OUTCOME.CONSULTANT_INSUFFICIENT;
    }
    // Both false or undetermined
    return SESSION_OUTCOME.NEITHER_MET;
}
```

### What This Means in Practice

1. **For `no_show_client` / `no_show_consultant`:** The outcome is determined solely by the `attendanceStatus` string that the client or consultant sets via the API. There is **no server-side verification** that a no-show actually occurred.

2. **For `completed`:** The method reads `session.clientAttendanceMet` and `session.consultantAttendanceMet`. But as established in Section 4, **these fields are never set** — they remain `null` (falsy). Therefore:
   - `clientMet && consultantMet` → `null && null` → `false` → never returns `COMPLETED`
   - `consultantMet && !clientMet` → `null && !null` → `null && true` → `null` (falsy) → never returns `CUSTOMER_INSUFFICIENT`
   - `clientMet && !consultantMet` → same → never returns `CONSULTANT_INSUFFICIENT`
   - Falls through to `NEITHER_MET`

**Every session marked as `completed` via the API will produce `SESSION_OUTCOME.NEITHER_MET`** because the attendance met flags are never populated.

### No Automatic Outcome Determination

There is **no background job, cron, or reconciliation process** that:
- Checks whether a session should be marked as no-show
- Calculates attendance duration
- Determines whether the 80% threshold was met
- Transitions session status automatically

The only way a session reaches a terminal state is if a client or consultant explicitly calls `updateAttendance` with a terminal status.

---

## 6. Session → Earning

### Connection

**File:** `backend/src/services/consultation-session.service.js:150-160`

```javascript
// If session reached a terminal attendance state, create the earning
const terminalStatuses = ["completed", "no_show_client", "no_show_consultant"];
if (terminalStatuses.includes(attendanceStatus)) {
    const sessionOutcome = this._determineSessionOutcome(session, attendanceStatus);
    await consultantEarningService.createEarningFromSession(bookingId, sessionOutcome);
}
```

### Earning Creation Function

**File:** `backend/src/services/consultant-earning.service.js:190-290`

`createEarningFromSession(bookingId, sessionOutcome)`:

1. Validates `sessionOutcome` is a valid `SESSION_OUTCOME` enum value
2. Starts a MongoDB transaction
3. Loads booking, consultation session, payment (must be `status: "success"`), consultant profile
4. Checks for existing earning (idempotency within transaction)
5. Determines financial outcome from `sessionOutcome` via `determineEarningFromSessionOutcome()`
6. Creates the earning with `eligibleAt` = 24 hours in the future (for PENDING status)
7. Handles duplicate key error (E11000) for concurrent requests

### Required Conditions

- Booking must exist
- ConsultationSession must exist (for the bookingId)
- Payment must exist with `status: "success"`
- ConsultantProfile must exist
- No existing earning for the booking (idempotency)

### Idempotency

- **Within transaction:** `ConsultantEarning.findOne({ bookingId })` check
- **Across transactions:** Unique index on `bookingId` + E11000 error handling
- **Concurrent requests:** Both the in-transaction check and the unique index provide protection

### Critical Problem

The earning is created based on the `attendanceStatus` that the **client or consultant sets via the API** — with no server-side verification of actual attendance. A consultant could mark a session as `completed` (which would yield `NEITHER_MET` outcome and a HELD earning), or a client could mark a session as `no_show_consultant` (which would yield `CONSULTANT_NO_SHOW` and a CANCELLED earning with 0 entitlement).

The earning creation is **triggered by the same untrusted `updateAttendance` call** that sets the attendance status. There is no independent verification step.

---

## 7. Findings

### FINDING-CS-01 — CRITICAL: No automatic session creation

- **Severity:** CRITICAL
- **Location:** `backend/src/services/consultation-session.service.js:10-62` (createOrUpdateSession); `backend/src/services/payment.service.js:1137-1162` (reconcilePayment — does NOT create session); `backend/src/services/booking.service.js:385-418` (confirmBooking — does NOT create session)
- **Current behavior:** ConsultationSession is only created when a client or consultant calls `PUT /api/v1/sessions/booking/:bookingId` with notes/recordingUrl. It is NOT created when payment succeeds, when a booking is confirmed, or when a Google Calendar event is created.
- **Expected behavior:** A ConsultationSession should be created automatically when a booking is confirmed and paid, so that attendance tracking can begin.
- **Why it matters:** Without an automatically created session, there is no entity to track attendance, no-shows, or session outcomes. The entire session lifecycle depends on a manual API call that may never happen.
- **Requires schema change:** No
- **Requires Google API integration:** No
- **Affects financial correctness:** Yes — if no session is created, no earning can be created, and the consultant may not get paid.

### FINDING-CS-02 — CRITICAL: Attendance tracking fields exist but are never populated

- **Severity:** CRITICAL
- **Location:** `backend/src/models/ConsultationSession.js:65-124` (schema fields); `backend/src/services/consultation-session.service.js:89-164` (updateAttendance — does not populate attendanceEvents, durations, or met flags)
- **Current behavior:** The schema defines `attendanceEvents`, `clientAttendanceDuration`, `consultantAttendanceDuration`, `clientAttendanceMet`, and `consultantAttendanceMet`, but no service code ever writes to these fields. They remain at their defaults (`[]`, `0`, `0`, `null`, `null`).
- **Expected behavior:** Attendance events should be recorded on join/leave, durations should be calculated, and the 80% threshold should be evaluated.
- **Why it matters:** The system cannot determine whether a session was actually completed, whether participants met the attendance threshold, or whether a no-show occurred. All attendance data is self-reported.
- **Requires schema change:** No (fields exist)
- **Requires Google API integration:** Yes (to obtain real attendance data)
- **Affects financial correctness:** Yes — earnings are created based on self-reported attendance status.

### FINDING-CS-03 — CRITICAL: Any participant can set any attendance status without verification

- **Severity:** CRITICAL
- **Location:** `backend/src/controllers/consultation-session.controller.js:61-77` (updateAttendance); `backend/src/services/consultation-session.service.js:89-164` (updateAttendance)
- **Current behavior:** Any authenticated user who is the booking's client or consultant can call `PATCH /api/v1/sessions/booking/:bookingId/attendance` with any `attendanceStatus` value, including `no_show_client`, `no_show_consultant`, `completed`, `late_client`, `late_consultant`. There is no server-side verification of whether the participant actually joined, was late, or was a no-show.
- **Expected behavior:** Attendance status should be determined by server-side logic (e.g., Google Meet attendance data, grace period timers, or verified join/leave events), not by client self-reporting.
- **Why it matters:** A consultant can mark a session as `no_show_client` to claim the client didn't show (triggering a CUSTOMER_NO_SHOW earning with full consultant entitlement). A client can mark a session as `no_show_consultant` to claim the consultant didn't show (triggering a CONSULTANT_NO_SHOW earning with 0 entitlement and full refund). Either party can manipulate the outcome for financial gain.
- **Requires schema change:** No
- **Requires Google API integration:** Yes
- **Affects financial correctness:** Yes — directly.

### FINDING-CS-04 — CRITICAL: No grace period or no-show detection logic

- **Severity:** CRITICAL
- **Location:** `backend/src/services/consultation-session.service.js` (entire file — no grace period logic exists)
- **Current behavior:** There is no 15-minute consultant grace period, no 20-minute customer waiting period, and no automatic no-show detection. The only no-show logic is the `no_show_client` and `no_show_consultant` enum values that can be set by either party via the API.
- **Expected behavior:** The system should automatically detect no-shows based on join timestamps relative to the scheduled session start time, with configurable grace periods.
- **Why it matters:** Business rules 1 and 2 (consultant no-show → 100% refund, 0 payout; customer no-show → no refund, consultant gets 85%) cannot be enforced without automated detection.
- **Requires schema change:** No (but needs scheduled session start time, which is on Booking)
- **Requires Google API integration:** Yes (to verify actual join times)
- **Affects financial correctness:** Yes.

### FINDING-CS-05 — CRITICAL: No 80% attendance threshold calculation

- **Severity:** CRITICAL
- **Location:** `backend/src/services/consultation-session.service.js:172-200` (_determineSessionOutcome); `backend/src/models/ConsultationSession.js:112-124` (clientAttendanceMet/consultantAttendanceMet fields)
- **Current behavior:** The `_determineSessionOutcome` method reads `session.clientAttendanceMet` and `session.consultantAttendanceMet` to determine the outcome for "completed" sessions. However, these fields are **never set** by any service — they remain `null`. Since `null` is falsy, every "completed" session produces `SESSION_OUTCOME.NEITHER_MET`, which maps to a HELD earning with `NEITHER_MET_INVESTIGATION` hold reason.
- **Expected behavior:** The system should calculate actual attendance duration (from join/leave events or Google Meet data), compare it to 80% of the scheduled session duration, and set the `clientAttendanceMet`/`consultantAttendanceMet` flags accordingly.
- **Why it matters:** Business rule 3 (session completion requires 80% attendance) cannot be enforced. All completed sessions are treated as "neither met" and held for investigation.
- **Requires schema change:** No (fields exist)
- **Requires Google API integration:** Yes
- **Affects financial correctness:** Yes — all completed sessions are held, preventing consultant payouts.

### FINDING-CS-06 — HIGH: No state transition validation on attendance status

- **Severity:** HIGH
- **Location:** `backend/src/services/consultation-session.service.js:89-164` (updateAttendance)
- **Current behavior:** The `updateAttendance` method accepts any `attendanceStatus` value and applies it directly via `$set`. There is no validation of valid state transitions. A session can go from `not_started` → `completed`, or from `completed` → `no_show_client`, or from `in_progress` → `no_show_consultant`.
- **Expected behavior:** State transitions should be validated (e.g., `not_started` → `in_progress` → `completed`; `not_started` → `no_show_client`; etc.).
- **Why it matters:** Invalid transitions can produce inconsistent session states and incorrect earning outcomes.
- **Requires schema change:** No
- **Requires Google API integration:** No
- **Affects financial correctness:** Yes — invalid transitions can trigger incorrect earning creation.

### FINDING-CS-07 — HIGH: Non-atomic session creation (race condition)

- **Severity:** HIGH
- **Location:** `backend/src/services/consultation-session.service.js:30-44` (createOrUpdateSession)
- **Current behavior:** Session creation uses `findOne` then `create` — a non-atomic check-then-act pattern. If two concurrent requests arrive, both may find no existing session and both attempt to create. The unique index on `bookingId` will reject the second, but the error is **not caught** — it propagates as an unhandled error (500).
- **Expected behavior:** Session creation should be atomic (e.g., using `findOneAndUpdate` with `upsert: true` and `$setOnInsert`, or a transaction).
- **Why it matters:** Concurrent requests can cause 500 errors and inconsistent state.
- **Requires schema change:** No
- **Requires Google API integration:** No
- **Affects financial correctness:** Indirectly — a failed session creation prevents earning creation.

### FINDING-CS-08 — HIGH: Earning created from self-reported attendance status

- **Severity:** HIGH
- **Location:** `backend/src/services/consultation-session.service.js:150-160` (updateAttendance → createEarningFromSession); `backend/src/services/consultant-earning.service.js:190-290` (createEarningFromSession)
- **Current behavior:** When a terminal `attendanceStatus` is set via the API, the system immediately creates a ConsultantEarning based on the `_determineSessionOutcome` result. The earning creation is triggered by the same untrusted API call that sets the status. There is no independent verification of attendance before the earning is created.
- **Expected behavior:** Earning creation should be based on verified attendance data (from Google Meet or server-side tracking), not on client self-reporting.
- **Why it matters:** A participant can manipulate the earning outcome by setting a specific attendance status.
- **Requires schema change:** No
- **Requires Google API integration:** Yes
- **Affects financial correctness:** Yes — directly.

### FINDING-CS-09 — HIGH: No leave/rejoin tracking

- **Severity:** HIGH
- **Location:** `backend/src/models/ConsultationSession.js:65-86` (attendanceEvents schema); `backend/src/services/consultation-session.service.js` (no code populates attendanceEvents)
- **Current behavior:** The `attendanceEvents` array is defined in the schema to support join/leave history, but no service code ever pushes to it. There is no mechanism to record when a participant leaves or rejoins.
- **Expected behavior:** Join and leave events should be recorded in `attendanceEvents`, and cumulative duration should be calculated from these events.
- **Why it matters:** Business rule 4 (leave/rejoin should accumulate attendance correctly) cannot be enforced.
- **Requires schema change:** No (fields exist)
- **Requires Google API integration:** Yes
- **Affects financial correctness:** Yes — attendance duration cannot be accurately calculated.

### FINDING-CS-10 — MEDIUM: No session-to-booking back-reference

- **Severity:** MEDIUM
- **Location:** `backend/src/models/Booking.js` (no `consultationSessionId` field); `backend/src/models/ConsultationSession.js:5-10` (has `bookingId`)
- **Current behavior:** The relationship is one-way: ConsultationSession has a `bookingId` reference to Booking, but Booking has no `consultationSessionId` reference back. There is no database-level foreign key constraint (MongoDB).
- **Expected behavior:** A bidirectional reference would allow efficient lookups from either side and ensure referential integrity.
- **Why it matters:** Querying for a session from a booking requires a separate query. The lack of a back-reference makes it harder to enforce consistency.
- **Requires schema change:** Yes (add `consultationSessionId` to Booking)
- **Requires Google API integration:** No
- **Affects financial correctness:** Indirectly.

### FINDING-CS-11 — MEDIUM: Missing service methods referenced by controller

- **Severity:** MEDIUM
- **Location:** `backend/src/controllers/booking.controller.js:168-208` (getPendingRequests, getConsultantUpcomingSessions, getEarningsSummary); `backend/src/services/booking.service.js` (methods do not exist)
- **Current behavior:** The booking controller calls `bookingService.getPendingRequests()`, `bookingService.getConsultantUpcomingSessions()`, and `bookingService.getEarningsSummary()`, but these methods **do not exist** on the BookingService class. These would throw `TypeError: bookingService.getPendingRequests is not a function` at runtime.
- **Expected behavior:** These methods should be implemented or the routes should be removed.
- **Why it matters:** Three API endpoints are broken and will return 500 errors.
- **Requires schema change:** No
- **Requires Google API integration:** No
- **Affects financial correctness:** No (but affects consultant dashboard functionality).

### FINDING-CS-12 — MEDIUM: No Google Meet attendance integration

- **Severity:** MEDIUM
- **Location:** `backend/src/services/google-calendar.service.js` (entire file — only creates/updates/deletes events, no attendance API calls)
- **Current behavior:** The Google Calendar service only creates, updates, and deletes calendar events with Meet links. It does **not** call any Google Meet attendance API, does **not** set up webhooks for attendance data, and does **not** poll for attendance reports. There is no mechanism to obtain actual participant attendance data from Google Meet.
- **Expected behavior:** The system should use the Google Meet API (or Google Calendar API attendance features) to retrieve participant join/leave times and verify identity.
- **Why it matters:** Without Google Meet attendance data, the system cannot verify actual participation, making all attendance tracking self-reported.
- **Requires schema change:** No
- **Requires Google API integration:** Yes
- **Affects financial correctness:** Yes — indirectly, by preventing attendance verification.

### FINDING-CS-13 — MEDIUM: Meeting link is a local URL, not a Google Meet link

- **Severity:** MEDIUM
- **Location:** `backend/src/services/booking.service.js:750` (`generateMeetingLink` — creates `https://experthour.onrender.com/meeting/${booking._id}`)
- **Current behavior:** The `generateMeetingLink` method in the booking service creates a **local** meeting link (`https://experthour.onrender.com/meeting/${booking._id}`), not a Google Meet link. The actual Google Meet link is only created during payment reconciliation (`payment.service.js:1206-1213`) via `googleCalendarService.createEventAndGetMeetLink()`.
- **Expected behavior:** The meeting link should consistently be a Google Meet link.
- **Why it matters:** The local meeting link does not connect to Google Meet, so there is no actual video meeting infrastructure. The Google Meet link is only created if the consultant has connected their Google Calendar.
- **Requires schema change:** No
- **Requires Google API integration:** Yes (already partially implemented)
- **Affects financial correctness:** Indirectly.

### FINDING-CS-14 — LOW: No session state machine enforcement

- **Severity:** LOW
- **Location:** `backend/src/models/ConsultationSession.js` (no state machine); `backend/src/services/consultation-session.service.js` (no transition validation)
- **Current behavior:** The `attendanceStatus` field is a free-form enum with no enforced state machine. Any status can transition to any other status. There is no concept of terminal states (once `completed`, `no_show_client`, or `no_show_consultant`, the session should not be modifiable).
- **Expected behavior:** A state machine should enforce valid transitions and prevent modifications after a terminal state is reached.
- **Why it matters:** Data integrity — sessions can be modified after they are finalized, potentially creating inconsistent earning records.
- **Requires schema change:** No
- **Requires Google API integration:** No
- **Affects financial correctness:** Indirectly.

### FINDING-CS-15 — LOW: No hooks or middleware on ConsultationSession

- **Severity:** LOW
- **Location:** `backend/src/models/ConsultationSession.js` (no pre/post hooks)
- **Current behavior:** The ConsultationSession schema has no pre-save, post-save, or other middleware hooks. There is no automatic calculation of attendance durations, no automatic setting of `clientAttendanceMet`/`consultantAttendanceMet`, and no automatic earning creation.
- **Expected behavior:** Hooks could automate attendance calculation and outcome determination.
- **Why it matters:** All logic is in the service layer, which is not always invoked (e.g., direct database writes bypass it).
- **Requires schema change:** No
- **Requires Google API integration:** No
- **Affects financial correctness:** Indirectly.

---

## 8. Recommended Next Inspection

**Inspect the Google Calendar / Google Meet integration in depth** (`backend/src/services/google-calendar.service.js` and `backend/src/controllers/google-calendar.controller.js`).

Specifically determine:
1. Whether the Google Calendar API scope (`https://www.googleapis.com/auth/calendar.events`) grants access to Meet attendance data.
2. Whether the Google Meet API (separate from Calendar API) is available and could provide participant join/leave times.
3. Whether participant identity can be verified (the consultant and client are identified by their ExpertHour user IDs, but Google Meet identifies participants by their Google account email — there is no mapping).
4. Whether a webhook or polling mechanism exists or could be added to retrieve attendance data after a meeting ends.

This is the single most critical gap: without Google Meet attendance data, none of the attendance tracking, no-show detection, or 80% threshold calculation can be implemented reliably.
