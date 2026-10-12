import emailOutboxService from "./email-outbox.service.js";
import env from "../config/env.js";
import paymentLogger from "../utils/logger.js";

const {
    intervalMs,
    batchSize,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
    leaseMs,
} = env.emailOutbox;

/**
 * EmailOutboxWorker
 *
 * Drains the EmailOutbox collection: recovers expired leases, claims due
 * pending jobs, evaluates the recipient and their current effective
 * preferences, and delivers via the shared email service.
 *
 * This worker does NOT duplicate delivery policy. Every state transition is
 * delegated to emailOutboxService, which owns the guarded updates.
 *
 * Lifecycle follows the established worker contract (see
 * earning-eligibility.service.js and refund-reconciliation.service.js):
 *   - singleton with start()/stop()
 *   - duplicate startup prevented by an isRunning guard
 *   - recursive setTimeout, never overlapping setInterval
 *   - bounded batch per cycle
 *   - cycle-level failures are logged, never fatal
 *   - per-job failures are isolated so one bad job cannot block the rest
 *
 * Exactly-once limitation:
 *   SMTP provides no idempotency key. If the provider accepts a message and
 *   the process crashes before markAsSent commits, lease recovery re-claims
 *   the job and a second copy is sent. Delivery is therefore at-least-once,
 *   not exactly-once.
 *
 * Logging:
 *   Only job ids, counts, durations, and sanitized error messages are logged.
 *   Destination addresses, template payloads, rendered HTML, credentials, and
 *   full provider responses are never logged.
 */
class EmailOutboxWorker {

    constructor() {

        this.isRunning = false;

        this.shutdownRequested = false;

        this.timerId = null;

    }

    /**
     * Start the email outbox worker.
     * Must be called after MongoDB connection is established.
     */
    start() {

        if (this.isRunning) {

            paymentLogger.info("email_outbox_worker_already_running", {

                event: "email_outbox_worker_already_running",

            });

            return;

        }

        // Push the effective configuration into the service so both agree on
        // retry and lease behaviour instead of using conflicting defaults.
        emailOutboxService.configure({
            maxAttempts,
            leaseMs,
            baseDelayMs,
            maxDelayMs,
        });

        this.isRunning = true;

        this.shutdownRequested = false;

        paymentLogger.info("email_outbox_worker_starting", {

            event: "email_outbox_worker_starting",

            intervalMs,

            batchSize,

            maxAttempts,

            baseDelayMs,

            maxDelayMs,

            leaseMs,

        });

        this._scheduleNext();

    }

    /**
     * Request graceful shutdown.
     * The current cycle will finish, but no new cycle will start.
     */
    stop() {

        this.shutdownRequested = true;

        this.isRunning = false;

        if (this.timerId) {

            clearTimeout(this.timerId);

            this.timerId = null;

        }

        paymentLogger.info("email_outbox_worker_shutdown_requested", {

            event: "email_outbox_worker_shutdown_requested",

        });

    }

    /**
     * Schedule the next drain cycle.
     * Uses recursive setTimeout to prevent overlapping executions.
     */
    _scheduleNext() {

        if (this.shutdownRequested) {

            this.isRunning = false;

            paymentLogger.info("email_outbox_worker_stopped", {

                event: "email_outbox_worker_stopped",

            });

            return;

        }

        this.timerId = setTimeout(() => {

            this._runCycle().finally(() => {

                this._scheduleNext();

            });

        }, intervalMs);

    }

    /**
     * Execute one drain cycle.
     *
     * Order matters: expired leases are recovered first so a job abandoned by
     * a crashed worker becomes claimable in the same cycle.
     *
     * @returns {Promise<object>} cycle counters
     */
    async _runCycle() {

        const cycleStart = Date.now();

        paymentLogger.info("email_outbox_cycle_started", {

            event: "email_outbox_cycle_started",

            cycleStart: new Date(cycleStart).toISOString(),

        });

        const counters = {
            recovered: 0,
            deadLettered: 0,
            processed: 0,
            sent: 0,
            suppressed: 0,
            dead: 0,
            retried: 0,
            failed: 0,
        };

        try {

            // 1. Recover jobs abandoned by a crashed worker.
            const { recovered, deadLettered } = await emailOutboxService.recoverExpiredLeases({
                limit: batchSize,
            });

            counters.recovered = recovered;
            counters.deadLettered = deadLettered;

            // 2. Drain up to `batchSize` due jobs.
            for (let i = 0; i < batchSize; i += 1) {

                if (this.shutdownRequested) {

                    paymentLogger.info("email_outbox_shutdown_during_cycle", {

                        event: "email_outbox_shutdown_during_cycle",

                        processed: counters.processed,

                    });

                    break;

                }

                const job = await emailOutboxService.claimNextPendingJob();

                if (!job) {

                    // Nothing due right now.
                    break;

                }

                counters.processed += 1;

                await this._processJob(job, counters);

            }

            paymentLogger.info("email_outbox_cycle_completed", {

                event: "email_outbox_cycle_completed",

                cycleDurationMs: Date.now() - cycleStart,

                ...counters,

            });

            return counters;

        } catch (error) {

            // A cycle-level failure is logged but never fatal: the next cycle
            // is still scheduled by _scheduleNext's finally handler.
            paymentLogger.error("email_outbox_cycle_failed", {

                event: "email_outbox_cycle_failed",

                error: error.message,

                ...counters,

            });

            return counters;

        }

    }

    /**
     * Process a single claimed job.
     *
     * Per-job failures are isolated: an error here is caught, recorded, and
     * the loop continues with the next job.
     *
     * @param {object} job - a claimed EmailOutbox document in `processing`
     * @param {object} counters - mutable cycle counters
     * @private
     */
    async _processJob(job, counters) {

        try {

            // 3. Evaluate the CURRENT recipient and CURRENT effective
            //    preferences immediately before sending.
            const decision = await emailOutboxService.evaluateDelivery(job);

            if (decision.action === "suppress") {

                const suppressed = await emailOutboxService.markAsSuppressed(
                    job._id,
                    decision.reason
                );

                if (suppressed) {

                    counters.suppressed += 1;

                    paymentLogger.info("email_outbox_job_suppressed", {

                        event: "email_outbox_job_suppressed",

                        jobId: job._id.toString(),

                    });

                }

                return;

            }

            if (decision.action === "dead") {

                const dead = await emailOutboxService.markAsDead(
                    job._id,
                    new Error(decision.reason)
                );

                if (dead) {

                    counters.dead += 1;

                    paymentLogger.info("email_outbox_job_dead", {

                        event: "email_outbox_job_dead",

                        jobId: job._id.toString(),

                    });

                }

                return;

            }

            // 4. Deliver.
            await emailOutboxService.sendJob(job);

            // 5. Record success. A null result means a stale worker lost the
            //    race; that is logged, not counted as a send.
            const sent = await emailOutboxService.markAsSent(job._id);

            if (sent) {

                counters.sent += 1;

                paymentLogger.info("email_outbox_job_sent", {

                    event: "email_outbox_job_sent",

                    jobId: job._id.toString(),

                });

            } else {

                paymentLogger.info("email_outbox_job_send_stale", {

                    event: "email_outbox_job_send_stale",

                    jobId: job._id.toString(),

                });

            }

        } catch (error) {

            await this._handleJobFailure(job, error, counters);

        }

    }

    /**
     * Handle a per-job failure.
     *
     * Permanent payload/template problems are dead-lettered immediately so a
     * malformed job cannot burn through every retry. Everything else is
     * treated as transient and scheduled for retry by the service.
     *
     * @private
     */
    async _handleJobFailure(job, error, counters) {

        // A 400 from the service means the payload or template is invalid.
        // Retrying cannot fix that, so dead-letter it now.
        const isPermanent = error && error.statusCode === 400;

        try {

            if (isPermanent) {

                const dead = await emailOutboxService.markAsDead(job._id, error);

                if (dead) {

                    counters.dead += 1;

                    paymentLogger.error("email_outbox_job_dead", {

                        event: "email_outbox_job_dead",

                        jobId: job._id.toString(),

                        error: error.message,

                    });

                }

                return;

            }

            const { job: updated, retried } =
                await emailOutboxService.recordFailureAndScheduleRetry(job._id, error);

            if (retried && updated) {

                counters.retried += 1;

                paymentLogger.error("email_outbox_job_retry_scheduled", {

                    event: "email_outbox_job_retry_scheduled",

                    jobId: job._id.toString(),

                    attempts: updated.attempts,

                    maxAttempts: updated.maxAttempts,

                    error: error.message,

                });

            } else if (updated) {

                // The service dead-letters once the attempt limit is reached.
                counters.dead += 1;

                paymentLogger.error("email_outbox_job_dead", {

                    event: "email_outbox_job_dead",

                    jobId: job._id.toString(),

                    attempts: updated.attempts,

                    error: error.message,

                });

            } else {

                // Guarded update matched nothing: a stale worker.
                paymentLogger.info("email_outbox_job_failure_stale", {

                    event: "email_outbox_job_failure_stale",

                    jobId: job._id.toString(),

                });

            }

        } catch (handlingError) {

            // The failure handler itself failed. Log and move on so one job
            // cannot terminate the cycle.
            counters.failed += 1;

            paymentLogger.error("email_outbox_job_failure_handling_failed", {

                event: "email_outbox_job_failure_handling_failed",

                jobId: job._id.toString(),

                error: handlingError.message,

            });

        }

    }

    /**
     * Manually trigger a drain cycle.
     * Useful for admin-triggered processing or testing.
     *
     * A manual cycle is an explicit, synchronous invocation, so it is not
     * governed by the scheduler's shutdown flag: the flag is cleared for the
     * duration of the cycle and restored afterwards. This keeps `stop()`
     * semantics intact for the scheduled path while allowing `processNow()`
     * to run to completion after a previous `stop()`.
     *
     * @returns {Promise<object>} cycle counters
     */
    async processNow() {

        if (this.isRunning) {

            throw new Error("Email outbox worker is already running");

        }

        const previousShutdownRequested = this.shutdownRequested;

        this.isRunning = true;

        this.shutdownRequested = false;

        try {

            return await this._runCycle();

        } finally {

            this.isRunning = false;

            this.shutdownRequested = previousShutdownRequested;

        }

    }

}

export default new EmailOutboxWorker();
