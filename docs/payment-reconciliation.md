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
- No implemented manual recovery or administrative recovery path was found in the inspected code. This is an operational limitation, not a guarantee that no external procedure exists.
- The `"maximum retry"` error branch is counted as a terminal failure and contributes to both `failed` and `maxReached`.

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