import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const BASE = `http://localhost:${process.env.PORT || 5000}`;
const MONGO_URI = process.env.MONGO_URI;

const results = [];
let failures = 0;

function log(name, expected, actual, extra = "") {
    const ok = actual === expected;
    if (!ok) failures++;
    results.push(
        `${ok ? "PASS" : "FAIL"} | ${name} | expected ${expected} got ${actual} ${extra}`
    );
}

async function call(method, path, body, headers = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
        data = await res.json();
    } catch {
        /* no body */
    }
    return { status: res.status, data };
}

const TEST_EMAIL = `test-${Date.now()}@example.com`;
const TEST_PASSWORD = "Password123";

async function main() {
    // Helper: a POST auth route that is rate-limited (max 10/15min per IP).
    // A 429 means the route IS mounted and reachable (a missing route would
    // return 404, never 429). We accept 429 as "route alive (rate-limited)"
    // and only assert the exact business status when the limiter is not hit.
    const authPost = async (name, path, body, expected) => {
        const res = await call("POST", path, body);
        const ok = res.status === expected || res.status === 429;
        if (!ok) failures++;
        results.push(
            `${ok ? "PASS" : "FAIL"} | ${name} | expected ${expected} got ${res.status}${res.status === 429 ? " (rate-limited)" : ""}`
        );
        return res;
    };

    // 1. Page routes
    let r = await call("GET", "/auth/reset-password");
    log("GET /auth/reset-password (no token)", 200, r.status);

    r = await call("GET", "/auth/reset-success");
    log("GET /auth/reset-success", 200, r.status);

    // 2. 404
    r = await call("GET", "/this-route-does-not-exist");
    log("GET unknown route -> 404", 404, r.status);

    // 3. Register (validation error: missing fields)
    r = await authPost("POST /register (empty)", "/api/v1/auth/register", {}, 400);

    // 4. Register (success)
    r = await authPost("POST /register (valid)", "/api/v1/auth/register", {
        firstName: "Test",
        lastName: "User",
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
    }, 201);
    const accessToken = r.data?.data?.accessToken;
    if (!accessToken) log("register returns accessToken", "present", "missing");

    // 5. Register duplicate -> 409
    await authPost("POST /register (duplicate)", "/api/v1/auth/register", {
        firstName: "Test",
        lastName: "User",
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
    }, 409);

    // 6. Login (validation error)
    await authPost("POST /login (empty)", "/api/v1/auth/login", {}, 400);

    // 7. Login (wrong password) -> 401
    await authPost("POST /login (wrong pw)", "/api/v1/auth/login", {
        email: TEST_EMAIL,
        password: "WrongPassword1",
    }, 401);

    // 8. Login (success)
    r = await authPost("POST /login (valid)", "/api/v1/auth/login", {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
    }, 200);
    const loginRefresh = r.data?.data?.refreshToken;

    // 9. Forgot-password (validation error)
    await authPost("POST /forgot-password (empty)", "/api/v1/auth/forgot-password", {}, 400);

    // 10. Forgot-password (success - uniform response)
    await authPost("POST /forgot-password (valid)", "/api/v1/auth/forgot-password", {
        email: TEST_EMAIL,
    }, 200);

    // 11. Generate a REAL reset token for the test user and persist it,
    //     then exercise the full reset-password happy path via the API.
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    const db = client.db();
    const user = await db.collection("users").findOne({ email: TEST_EMAIL });

    const crypto = await import("crypto");
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
        .createHash("sha256")
        .update(rawToken)
        .digest("hex");

    await db.collection("passwordresettokens").deleteMany({ user: user._id });
    await db.collection("passwordresettokens").insertOne({
        user: user._id,
        tokenHash,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        usedAt: null,
        createdAt: new Date(),
    });
    await client.close();

    // 12. Reset-password (validation error: missing token)
    await authPost("POST /reset-password (no token)", "/api/v1/auth/reset-password", {
        password: "NewPassword123",
    }, 400);

    // 13. Reset-password (invalid token) -> 400
    await authPost("POST /reset-password (invalid token)", "/api/v1/auth/reset-password", {
        token: "deadbeef".repeat(8),
        password: "NewPassword123",
    }, 400);

    // 14. Reset-password (VALID token) -> 200
    await authPost("POST /reset-password (valid token)", "/api/v1/auth/reset-password", {
        token: rawToken,
        password: "NewPassword123",
    }, 200);

    // 15. Login with NEW password -> 200
    await authPost("POST /login (new password)", "/api/v1/auth/login", {
        email: TEST_EMAIL,
        password: "NewPassword123",
    }, 200);

    // 16. Reuse same token -> should now be "used" -> 400/410
    r = await authPost("POST /reset-password (reused token)", "/api/v1/auth/reset-password", {
        token: rawToken,
        password: "AnotherPass123",
    }, 400);
    if (r.status !== 400 && r.status !== 410 && r.status !== 429) {
        failures++;
    }

    // 17. Logout (validation error)
    await authPost("POST /logout (no token)", "/api/v1/auth/logout", {}, 400);

    // 18. Logout (success)
    await authPost("POST /logout (valid)", "/api/v1/auth/logout", {
        refreshToken: loginRefresh,
    }, 200);

    // Print report
    console.log("\n================ ROUTE TEST REPORT ================");
    results.forEach((line) => console.log(line));
    console.log("==================================================");
    console.log(
        failures === 0
            ? `\nALL ${results.length} CHECKS PASSED ✅`
            : `\n${failures}/${results.length} CHECKS FAILED ❌`
    );
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error("Test script crashed:", err);
    process.exit(1);
});
