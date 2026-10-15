/**
 * NotificationRealtime — Phase 3B.7
 *
 * Real-time delivery of PERSISTED in-app notifications over Socket.IO.
 *
 * Design rules:
 *   1. The database remains the source of truth. This module never creates,
 *      reads, or mutates a Notification. It only announces that one already
 *      exists, so a client can refetch authoritative data.
 *   2. Every connection is authenticated with the SAME access-token contract
 *      as `middlewares/auth.middleware.js`. The recipient identity is derived
 *      exclusively from the verified token — never from client input.
 *   3. Each authenticated user joins exactly one private room,
 *      `user:<verified-user-id>`. There is no client-accessible room-joining
 *      or subscription event, so a client cannot select another user's room.
 *   4. The emitted payload is a minimal signal (`{ notificationId }`). No
 *      notification body, no recipient list, no email address, no dedupeKey,
 *      no token.
 *   5. Emission is best-effort. A failure is logged with safe identifiers only
 *      and swallowed, so it can never reverse a persisted domain outcome.
 *
 * Scope: in-app real-time only. Email delivery, preferences, and the
 * notification REST API are untouched.
 *
 * Deployment note: this module is single-instance. If the service is ever
 * scaled horizontally, a Socket.IO adapter is required so an event emitted on
 * one instance reaches sockets connected to another.
 */

import { Server } from "socket.io";

import jwt from "jsonwebtoken";

import authConfig from "../config/auth.js";
import paymentLogger from "../utils/logger.js";
import User from "../models/User.js";

/**
 * Event name for a newly persisted notification. Kept as a constant so the
 * backend emitter and the frontend listener cannot drift apart.
 */
export const NOTIFICATION_CREATED_EVENT = "notification:created";

/**
 * Room name for an authenticated user. Derived ONLY from the verified token's
 * user id, never from anything the client supplies.
 *
 * @param {string|object} userId
 * @returns {string}
 */
function userRoom(userId) {
    return `user:${userId.toString()}`;
}

class NotificationRealtime {

    constructor() {

        this.io = null;

    }

    /**
     * Attach Socket.IO to an existing HTTP server.
     *
     * Does NOT create a new listener or port — it upgrades the server that
     * `app.listen()` already returned. CORS reuses the same origin allowlist
     * and credential convention as the Express CORS middleware.
     *
     * @param {import("http").Server} httpServer - the existing HTTP server
     * @param {string[]} allowedOrigins - the same origins Express CORS uses
     * @returns {Server} the Socket.IO server
     */
    attach(httpServer, allowedOrigins) {

        if (this.io) {
            return this.io;
        }

        this.io = new Server(httpServer, {
            cors: {
                origin: allowedOrigins.length > 0 ? allowedOrigins : false,
                credentials: true,
            },
        });

        // Handshake authentication. Mirrors middlewares/auth.middleware.js:
        // verify the JWT, load the user, enforce the password-change
        // invalidation window, and apply the same email-verification rule.
        this.io.use(async (socket, next) => {

            try {

                const user = await this._authenticate(socket);

                // Stash the verified identity on the socket. Everything
                // downstream reads this — never socket.handshake.auth.
                socket.data.userId = user._id.toString();

                next();

            } catch (error) {

                // Never leak why authentication failed beyond a generic
                // reason, and never log the token itself.
                paymentLogger.warn("realtime_auth_rejected", {
                    event: "realtime_auth_rejected",
                    reason: error?.message || "unauthorized",
                });

                next(new Error("Unauthorized"));

            }

        });

        this.io.on("connection", (socket) => {

            // Join the private room derived from the VERIFIED user id.
            socket.join(userRoom(socket.data.userId));

            paymentLogger.info("realtime_connected", {
                event: "realtime_connected",
                socketId: socket.id,
            });

            socket.on("disconnect", (reason) => {

                paymentLogger.info("realtime_disconnected", {
                    event: "realtime_disconnected",
                    socketId: socket.id,
                    reason,
                });

            });

        });

        paymentLogger.info("realtime_attached", {
            event: "realtime_attached",
        });

        return this.io;

    }

    /**
     * Verify a socket handshake and resolve the authenticated user.
     *
     * The token is read from `socket.handshake.auth.token` — never from a URL,
     * query string, or cookie, so it cannot leak into logs or referrers.
     *
     * @param {import("socket.io").Socket} socket
     * @returns {Promise<object>} the User document
     * @throws {Error} when authentication fails
     * @private
     */
    async _authenticate(socket) {

        const token = socket.handshake.auth && socket.handshake.auth.token;

        if (!token || typeof token !== "string") {
            throw new Error("Missing access token");
        }

        let decoded;

        try {

            decoded = jwt.verify(token, authConfig.accessToken.secret);

        } catch {

            // Covers malformed, tampered, and expired tokens.
            throw new Error("Invalid or expired token");

        }

        const user = await User.findById(decoded.userId);

        if (!user) {
            throw new Error("User not found");
        }

        // Invalidate stateless access tokens issued before the last password
        // change — the same rule as the HTTP middleware.
        if (
            user.passwordChangedAt &&
            decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)
        ) {
            throw new Error("Token invalidated by password change");
        }

        // The notification routes use `skipEmailVerification: true` so an
        // unverified user can still read their notifications (they need them
        // to complete verification). The socket contract matches that.
        if (user.isActive === false) {
            throw new Error("Account is inactive");
        }

        return user;

    }

    /**
     * Announce a newly persisted notification to one recipient.
     *
     * Best-effort: any failure is logged with safe identifiers only and
     * swallowed, so it can never fail the caller's notification operation or
     * undo persisted data.
     *
     * @param {string|object} userId - the authenticated recipient's User id
     * @param {string|object} notificationId - the persisted notification id
     * @returns {boolean} true when the event was handed to Socket.IO
     */
    emitNotificationCreated(userId, notificationId) {

        try {

            if (!this.io || !userId || !notificationId) {
                return false;
            }

            this.io.to(userRoom(userId)).emit(NOTIFICATION_CREATED_EVENT, {
                notificationId: notificationId.toString(),
            });

            return true;

        } catch (error) {

            paymentLogger.error("realtime_emit_failed", {
                event: "realtime_emit_failed",
                error: error?.message || error,
            });

            return false;

        }

    }

    /**
     * Close every open connection and release the Socket.IO server.
     * Safe to call when never attached.
     *
     * @returns {Promise<void>}
     */
    async close() {

        if (!this.io) {
            return;
        }

        try {

            await this.io.close();

        } catch (error) {

            paymentLogger.error("realtime_close_failed", {
                event: "realtime_close_failed",
                error: error?.message || error,
            });

        } finally {

            this.io = null;

        }

    }

}

export default new NotificationRealtime();
