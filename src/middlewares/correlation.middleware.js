import { randomUUID } from "crypto";

/**
 * Correlation ID middleware.
 *
 * Generates or reuses a request ID and attaches it to:
 * - req.id (standard Node.js request id)
 * - req.correlationId
 * - res.locals.correlationId
 *
 * Also sets X-Request-ID and X-Correlation-ID response headers.
 */

const correlationMiddleware = (req, res, next) => {

    const existing = req.headers["x-request-id"] || req.headers["x-correlation-id"];

    const correlationId = existing && typeof existing === "string" ? existing : randomUUID();

    req.id = correlationId;

    req.correlationId = correlationId;

    res.locals.correlationId = correlationId;

    res.setHeader("X-Request-ID", correlationId);

    res.setHeader("X-Correlation-ID", correlationId);

    next();

};

export default correlationMiddleware;
