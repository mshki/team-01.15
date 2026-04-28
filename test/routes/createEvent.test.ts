import request from "supertest";
import { createComposedApp } from "../../src/composition";
import { createInMemoryEventRepository } from "../../src/repository/InMemoryEventRepository";
import type { ILoggingService } from "../../src/service/LoggingService";

const silentLogger: ILoggingService = {
    info: () => {},
    warn: () => {},
    error: () => {},
};

function buildApp() {
    const repo = createInMemoryEventRepository();
    const app = createComposedApp(silentLogger, repo);
    return app.getExpressApp();
}

// Returns a supertest agent with a session cookie for the given demo user.
// Uses the real /login POST so the session is wired up exactly as production.
async function loginAs(
    agent: ReturnType<typeof request.agent>,
    email: string,
    password = "password123"
) {
    await agent
        .post("/login")
        .type("form")
        .send({ email, password });
}

// Reasonable future datetimes for a valid event.
const START = "2030-06-01T10:00";
const END   = "2030-06-01T12:00";

function validBody(overrides: Record<string, string> = {}) {
    return {
        name: "Test Event",
        description: "A test event description.",
        location: "Room 101",
        category: "",
        status: "DRAFT",
        startDatetime: START,
        endDatetime: END,
        capacity: "",
        ...overrides,
    };
}

// ── GET /events/new ──────────────────────────────────────────────────────────

describe("GET /events/new — showEventForm", () => {
    it("redirects unauthenticated users to /login", async () => {
        const agent = request.agent(buildApp());
        const res = await agent.get("/events/new");
        expect(res.status).toBe(302);
        expect(res.headers.location).toContain("/login");
    });

    it("returns 200 for an authenticated staff user", async () => {
        const agent = request.agent(buildApp());
        await loginAs(agent, "staff@app.test");
        const res = await agent.get("/events/new");
        expect(res.status).toBe(200);
    });

    it("returns 200 for an authenticated admin user", async () => {
        const agent = request.agent(buildApp());
        await loginAs(agent, "admin@app.test");
        const res = await agent.get("/events/new");
        expect(res.status).toBe(200);
    });

    it("returns 200 for an authenticated regular user (form is shown; creation is blocked at POST)", async () => {
        const agent = request.agent(buildApp());
        await loginAs(agent, "user@app.test");
        const res = await agent.get("/events/new");
        // The GET route only checks authentication, not role.
        expect(res.status).toBe(200);
    });
});

// ── POST /events — createEvent ───────────────────────────────────────────────

describe("POST /events — happy path", () => {
    it("staff user can create a DRAFT event and is redirected to /home", async () => {
        const agent = request.agent(buildApp());
        await loginAs(agent, "staff@app.test");

        const res = await agent
            .post("/events")
            .type("form")
            .send(validBody());

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain("/home");
    });

    it("admin user can create a DRAFT event and is redirected to /home", async () => {
        const agent = request.agent(buildApp());
        await loginAs(agent, "admin@app.test");

        const res = await agent
            .post("/events")
            .type("form")
            .send(validBody());

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain("/home");
    });

    it("staff user can create a PUBLISHED event", async () => {
        const agent = request.agent(buildApp());
        await loginAs(agent, "staff@app.test");

        const res = await agent
            .post("/events")
            .type("form")
            .send(validBody({ status: "PUBLISHED" }));

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain("/home");
    });

    it("creates an event with a numeric capacity", async () => {
        const agent = request.agent(buildApp());
        await loginAs(agent, "staff@app.test");

        const res = await agent
            .post("/events")
            .type("form")
            .send(validBody({ capacity: "50" }));

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain("/home");
    });

    it("HTMX request gets HX-Redirect header instead of a 302", async () => {
        const agent = request.agent(buildApp());
        await loginAs(agent, "staff@app.test");

        const res = await agent
            .post("/events")
            .type("form")
            .set("HX-Request", "true")
            .send(validBody());

        expect(res.status).toBe(200);
        expect(res.headers["hx-redirect"]).toContain("/home");
    });
});

// ── POST /events — authorization failures ───────────────────────────────────

describe("POST /events — authorization", () => {
    it("returns 401 for an unauthenticated request", async () => {
        const agent = request.agent(buildApp());

        const res = await agent
            .post("/events")
            .type("form")
            .send(validBody());

        expect(res.status).toBe(401);
    });

    it("returns 403 when a regular user (role=user) attempts to create an event", async () => {
        const agent = request.agent(buildApp());
        await loginAs(agent, "user@app.test");

        const res = await agent
            .post("/events")
            .type("form")
            .send(validBody());

        expect(res.status).toBe(403);
    });
});

// ── POST /events — validation failures ──────────────────────────────────────

describe("POST /events — validation errors re-render the form", () => {
    async function postAsStaff(body: Record<string, string>) {
        const agent = request.agent(buildApp());
        await loginAs(agent, "staff@app.test");
        return agent.post("/events").type("form").send(body);
    }

    it("rejects a missing title", async () => {
        const res = await postAsStaff(validBody({ name: "" }));
        expect(res.status).toBe(400);
        expect(res.text).toContain("Title is required.");
    });

    it("rejects a title that is too short (< 3 characters)", async () => {
        const res = await postAsStaff(validBody({ name: "AB" }));
        expect(res.status).toBe(400);
        expect(res.text).toContain("Title must be at least 3 characters.");
    });

    it("rejects a whitespace-only title", async () => {
        const res = await postAsStaff(validBody({ name: "   " }));
        expect(res.status).toBe(400);
        expect(res.text).toContain("Title is required.");
    });

    it("rejects a missing description", async () => {
        const res = await postAsStaff(validBody({ description: "" }));
        expect(res.status).toBe(400);
        expect(res.text).toContain("Description is required.");
    });

    it("rejects a whitespace-only description", async () => {
        const res = await postAsStaff(validBody({ description: "   " }));
        expect(res.status).toBe(400);
        expect(res.text).toContain("Description is required.");
    });

    it("rejects a missing location", async () => {
        const res = await postAsStaff(validBody({ location: "" }));
        expect(res.status).toBe(400);
        expect(res.text).toContain("Location is required.");
    });

    it("rejects a whitespace-only location", async () => {
        const res = await postAsStaff(validBody({ location: "   " }));
        expect(res.status).toBe(400);
        expect(res.text).toContain("Location is required.");
    });

    it("rejects end datetime that is the unix epoch (clearly invalid relative to a future start)", async () => {
        // Submitting a date string that produces a date far before the start
        // exercises the "end must be after start" guard.
        const res = await postAsStaff(
            validBody({ endDatetime: "1970-01-01T00:00" })
        );
        expect(res.status).toBe(400);
        expect(res.text).toContain("End datetime must be after start datetime.");
    });

    it("rejects end datetime that is before start datetime", async () => {
        const res = await postAsStaff(
            validBody({ startDatetime: "2030-06-01T12:00", endDatetime: "2030-06-01T10:00" })
        );
        expect(res.status).toBe(400);
        expect(res.text).toContain("End datetime must be after start datetime.");
    });

    it("rejects end datetime equal to start datetime", async () => {
        const res = await postAsStaff(
            validBody({ startDatetime: "2030-06-01T10:00", endDatetime: "2030-06-01T10:00" })
        );
        expect(res.status).toBe(400);
        expect(res.text).toContain("End datetime must be after start datetime.");
    });

    it("rejects capacity less than 1", async () => {
        const res = await postAsStaff(validBody({ capacity: "0" }));
        expect(res.status).toBe(400);
        expect(res.text).toContain("Capacity must be at least 1.");
    });

    it("treats non-numeric capacity as null (no capacity, no error)", async () => {
        // The route layer converts non-numeric capacity strings to null,
        // so this should succeed rather than error.
        const res = await postAsStaff(validBody({ capacity: "abc" }));
        // parseInt("abc") → NaN, which is not > 0, so route treats it as null
        // This is the route-layer behavior; service never sees a bad number.
        expect([200, 302]).toContain(res.status);
    });
});

// ── POST /events — HTMX validation errors ───────────────────────────────────

describe("POST /events — HTMX validation errors", () => {
    it("returns 200 with re-rendered partial on validation error (not 400)", async () => {
        const agent = request.agent(buildApp());
        await loginAs(agent, "staff@app.test");

        const res = await agent
            .post("/events")
            .type("form")
            .set("HX-Request", "true")
            .send(validBody({ name: "" }));

        // HTMX always gets 200 so the browser can swap the partial
        expect(res.status).toBe(200);
        expect(res.text).toContain("Title is required.");
    });
});

// ── POST /events — invalid status values ────────────────────────────────────

describe("POST /events — status coercion", () => {
    it("falls back to DRAFT when an invalid status string is submitted", async () => {
        const agent = request.agent(buildApp());
        await loginAs(agent, "staff@app.test");

        // Route coerces unknown status values to "DRAFT"
        const res = await agent
            .post("/events")
            .type("form")
            .send(validBody({ status: "INVALID_STATUS" }));

        expect(res.status).toBe(302);
        expect(res.headers.location).toContain("/home");
    });
});
