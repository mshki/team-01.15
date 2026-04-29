import request from "supertest";
import BetterSqlite3 from "better-sqlite3";
import path from "node:path";
import { createComposedApp } from "../../src/composition";
import type { ILoggingService } from "../../src/service/LoggingService";

const silentLogger: ILoggingService = {
    info: () => {},
    warn: () => {},
    error: () => {},
};

function buildApp(mode: "memory" | "test_prisma") {
    return createComposedApp(mode, silentLogger).getExpressApp();
}

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

describe.each([["memory"], ["test_prisma"]] as const)("createEvent tests (%s mode)", (mode) => {
    afterEach(() => {
        if (mode === "test_prisma") {
            const db = new BetterSqlite3(path.resolve(process.env.TEST_DB_URL!.replace(/^file:/, "")));
            db.prepare("DELETE FROM RSVP").run();
            db.prepare("DELETE FROM Event").run();
            db.close();
        }
    });

    // ── GET /events/new ──────────────────────────────────────────────────────────

    describe("GET /events/new — showEventForm", () => {
        it("redirects unauthenticated users to /login", async () => {
            const agent = request.agent(buildApp(mode));
            const res = await agent.get("/events/new");
            expect(res.status).toBe(302);
            expect(res.headers.location).toContain("/login");
        });

        it("returns 200 for an authenticated staff user", async () => {
            const agent = request.agent(buildApp(mode));
            await loginAs(agent, "staff@app.test");
            const res = await agent.get("/events/new");
            expect(res.status).toBe(200);
        });

        it("returns 200 for an authenticated admin user", async () => {
            const agent = request.agent(buildApp(mode));
            await loginAs(agent, "admin@app.test");
            const res = await agent.get("/events/new");
            expect(res.status).toBe(200);
        });

        it("returns 200 for an authenticated regular user (form is shown; creation is blocked at POST)", async () => {
            const agent = request.agent(buildApp(mode));
            await loginAs(agent, "user@app.test");
            const res = await agent.get("/events/new");
            expect(res.status).toBe(200);
        });
    });

    // ── POST /events — happy path ────────────────────────────────────────────────

    describe("POST /events — happy path", () => {
        it("staff user can create a DRAFT event and is redirected to /home", async () => {
            const agent = request.agent(buildApp(mode));
            await loginAs(agent, "staff@app.test");

            const res = await agent
                .post("/events")
                .type("form")
                .send(validBody());

            expect(res.status).toBe(302);
            expect(res.headers.location).toContain("/home");
        });

        it("admin user can create a DRAFT event and is redirected to /home", async () => {
            const agent = request.agent(buildApp(mode));
            await loginAs(agent, "admin@app.test");

            const res = await agent
                .post("/events")
                .type("form")
                .send(validBody());

            expect(res.status).toBe(302);
            expect(res.headers.location).toContain("/home");
        });

        it("staff user can create a PUBLISHED event", async () => {
            const agent = request.agent(buildApp(mode));
            await loginAs(agent, "staff@app.test");

            const res = await agent
                .post("/events")
                .type("form")
                .send(validBody({ status: "PUBLISHED" }));

            expect(res.status).toBe(302);
            expect(res.headers.location).toContain("/home");
        });

        it("creates an event with a numeric capacity", async () => {
            const agent = request.agent(buildApp(mode));
            await loginAs(agent, "staff@app.test");

            const res = await agent
                .post("/events")
                .type("form")
                .send(validBody({ capacity: "50" }));

            expect(res.status).toBe(302);
            expect(res.headers.location).toContain("/home");
        });

        it("HTMX request gets HX-Redirect header instead of a 302", async () => {
            const agent = request.agent(buildApp(mode));
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
            const agent = request.agent(buildApp(mode));

            const res = await agent
                .post("/events")
                .type("form")
                .send(validBody());

            expect(res.status).toBe(401);
        });

        it("returns 403 when a regular user (role=user) attempts to create an event", async () => {
            const agent = request.agent(buildApp(mode));
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
            const agent = request.agent(buildApp(mode));
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
            const res = await postAsStaff(validBody({ capacity: "abc" }));
            expect([200, 302]).toContain(res.status);
        });
    });

    // ── POST /events — HTMX validation errors ───────────────────────────────────

    describe("POST /events — HTMX validation errors", () => {
        it("returns 200 with re-rendered partial on validation error (not 400)", async () => {
            const agent = request.agent(buildApp(mode));
            await loginAs(agent, "staff@app.test");

            const res = await agent
                .post("/events")
                .type("form")
                .set("HX-Request", "true")
                .send(validBody({ name: "" }));

            expect(res.status).toBe(200);
            expect(res.text).toContain("Title is required.");
        });
    });

    // ── POST /events — invalid status values ────────────────────────────────────

    describe("POST /events — status coercion", () => {
        it("falls back to DRAFT when an invalid status string is submitted", async () => {
            const agent = request.agent(buildApp(mode));
            await loginAs(agent, "staff@app.test");

            const res = await agent
                .post("/events")
                .type("form")
                .send(validBody({ status: "INVALID_STATUS" }));

            expect(res.status).toBe(302);
            expect(res.headers.location).toContain("/home");
        });
    });
});
