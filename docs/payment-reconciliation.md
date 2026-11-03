# Payment Reconciliation Worker

Operational documentation for the payment reconciliation worker in `backend/src/services/payment-reconciliation.service.js`.

## Configuration

Durations are in milliseconds. Values can be overridden through environment variables.

| Environment variable | Default | Meaning |
|---|---:|---|
| `PAYMENT_RECONCILIATION_MAX_ATTEMPTS` | `3` | Maximum reconciliation attempts before a payment is excluded from candidate selection. |
| `PAYMENT_RECONCILIATION_DELAY_MS` | `5000` | Minimum age of a pending payment before it becomes eligible for reconciliation. |
| `PAYMENT_RECONCILIATION_TIMEOUT_MS` | `30000` | Minimum age of a processing payment before it is considered stale and eligible for recovery. |
| `PAYMENT_RECONCILIATION_INTERVAL_MS` | `300000` | Interval between reconciliation cycles. |
| `PAYMENT_RECONCILIATION_BATCH_SIZE` | `10` | Maximum number of candidates processed per cycle. |

## Candidate eligibility

Implemented by `_findCandidates()`:

- Pending payments qualify when `createdAt` is older than `now - delayMs` and `reconciliationAttempts < maxAttempts`.
- Processing payments qualify when `processingStartedAt` is older than `now - processingTimeoutMs` and `reconciliationAttempts < maxAttempts`.
- Each query applies `batchSize`; results are merged, deduplicated by reference, sorted by `createdAt`, and sliced to the overall batch size.
- The worker uses a fixed eligibility delay. Exponential backoff is not implemented.

## Retry exhaustion

- Payments with `reconciliationAttempts >= maxAttempts` are excluded from candidate selection.
- `maxReached` counts exhausted pending payments and exhausted stale processing payments, deduplicated by reference.
- Exhausted payments are not automatically marked failed merely because the limit was reached; they may remain pending or processing.
- The `"maximum retry"` error branch is counted as a terminal failure and contributes to both `failed` and `maxReached`.

## Admin payment recovery

A controlled administrative recovery path exists alongside the automatic worker.
It is intentionally separate from refund reconciliation and never bypasses the
Paystack verification or integrity checks.

### Endpoint

`POST /api/v1/admin/payments/:reference/reconcile`

- Implemented by `admin.controller.js` → `manualReconcilePayment()`, which
  delegates to `paymentService.manualReconcilePayment(reference, adminId, correlationId)`.
- **Authentication and authorization:** the entire admin router is wrapped with
  `authenticate()` then `authorize("ADMIN")`. Unauthenticated requests receive
  401; non-admin authenticated users receive 403.
- **Rate limiting:** `manualReconcileLimiter` (30 requests per 15 minutes per
  client IP) is applied to the route.
- **Validation:** `adminReferenceParamValidator` requires a non-empty string
  reference of 5–128 characters.

### Eligible payment statuses

- `pending` with `createdAt` older than `delayMs` and `reconciliationAttempts < maxAttempts`.
- `processing` with `processingStartedAt` older than `processingTimeoutMs` and
  `reconciliationAttempts < maxAttempts` (stale processing).
- **Not eligible:** `success`, `failed`, `abandoned` (terminal), active
  processing (elapsed < `processingTimeoutMs`), and exhausted payments.

### Exhausted-attempt behavior

- Payments with `reconciliationAttempts >= maxAttempts` are rejected with HTTP
  422 (`exhausted`). The retry counter is **not** reset, so manual recovery
  cannot bypass the automatic candidate-selection exhaustion safeguard.
- A `skipped` recovery audit record is written for the rejected attempt.

### Stale-processing recovery

- Active processing (elapsed < `processingTimeoutMs`) is rejected with HTTP 409
  (`processing`) — it is being handled by another request.
- Stale processing is recovered atomically: the payment is claimed and the
  existing `reconcilePayment()` flow is reused with `skipClaim: true`.

### Atomic claims and concurrency

- The manual claim uses an exclusive predicate: `status: "pending"` **or**
  `status: "processing" AND processingStartedAt < cutoff AND no other claim
  token present`. On success it writes an opaque `recoveryClaimToken` and
  `recoveryClaimedBy` (the initiating admin) onto the payment.
- Two administrators cannot both claim the same payment. The losing claimant
  receives a controlled `PaymentError` of type `processing`, mapped to HTTP 409.
- A losing claimant can never modify the winner's state: every subsequent
  mutation is guarded by the claim token, and the token is released on terminal
  settlement or on any revert to `pending`.

### Recovery audit records

- A `PaymentRecoveryAudit` record is written for every branch: `not_found`,
  `terminal`, `processing`, `skipped`, `success`, `failed`, and `error`.
- Each record identifies the initiating admin (`initiatedBy`), the outcome,
  the reason, and the `reconciliationAttempts` before and after.
- **Audit-write failure:** if the audit record cannot be persisted after a
  financial action has already occurred, the service fails loudly with HTTP
  503 (`audit_write_failed`) rather than reporting a fully audited recovery.
  The financial effect is not repeated on subsequent attempts.

### Paystack verification and integrity safeguards

- Manual recovery reuses `reconcilePayment()`, which performs Paystack
  verification and enforces reference, amount, currency, and booking integrity.
- Transient Paystack/network errors revert the payment to `pending` and are
  classified as transient; integrity failures revert to `pending` and are
  surfaced as integrity errors. Neither path corrupts committed state.

### Separation from refund reconciliation

- Manual recovery calls `reconcilePayment()` only. No refund code is reachable
  from the admin recovery path. Refund reconciliation lives in
  `refund-reconciliation.service.js` and `refund.service.js` with no route
  overlap.

## Cycle metrics

Semantics verified in `_runCycle()`:

- `processed`: candidates entering the processing loop.
- `succeeded`: successful reconciliation outcomes, including already-verified payments.
- `reconciled`: successful outcomes that were not already verified.
- `alreadyVerified`: successful outcomes already verified.
- `skippedProcessing`: reconciliation returned a processing status.
- `deferred`: reconciliation returned a pending status.
- `failed`: terminal failures only, not all caught errors.
- `terminalFailures`: terminal failure count.
- `transientErrors`: caught errors classified as transient.
- `unexpectedErrors`: other caught errors.
- `maxReached`: exhausted-payment count plus any maximum-retry cases encountered during the cycle. A payment can be counted more than once across the initial exhausted-payment query and a maximum-retry branch, so this metric is not necessarily a unique-payment count.

## Testing and known gaps

The cycle metrics test covers a successful reconciliation cycle. Existing reconciliation tests cover `reconcilePayment()` paths.

Insufficiently covered `_runCycle()` behaviors:

- Exclusion of exhausted payments.
- Recovery of stale processing payments.
- Batch-limit and merge behavior.
- `maxReached` calculation.