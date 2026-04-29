import request from "supertest";
import BetterSqlite3 from "better-sqlite3";
import path from "node:path";
import { createComposedApp } from "../../src/composition";
import { createEventService } from "../../src/service/EventService";
import { createInMemoryEventRepository } from "../../src/repository/InMemoryEventRepository";
import { CreateInMemoryUserRepository } from "../../src/auth/InMemoryUserRepository";
import { CreatePasswordHasher } from "../../src/auth/PasswordHasher";
import { CreateAuthService } from "../../src/auth/AuthService";
import { CreateAdminUserService } from "../../src/auth/AdminUserService";
import { CreateAuthController } from "../../src/auth/AuthController";
import { createEventController } from "../../src/controllers/EventController";
import { CreateApp } from "../../src/app";
import type { ILoggingService } from "../../src/service/LoggingService";
import type { CreateEventData } from "../../src/types/EventTypes";

const silentLogger: ILoggingService = {
    info: () => {},
    warn: () => {},
    error: () => {},
};

const START_STRING = "2030-06-01T10:00";
const END_STRING = "2030-06-01T12:00";

async function loginAs(
    agent: ReturnType<typeof request.agent>,
    email: string,
    password = "password123"
) {
    await agent.post("/login").type("form").send({ email, password });
}

// Creates an event via HTTP POST and returns its numeric ID.
// The logged-in user on `agent` becomes the organizer.
// A unique title is generated so the event can be reliably found after creation.
async function createEventViaHttp(
    agent: ReturnType<typeof request.agent>,
    overrides: Record<string, string> = {}
): Promise<number> {
    const uniqueTitle = `Test Event ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const { name: _ignored, ...restOverrides } = overrides;
    const titleToSearch = overrides.name ?? uniqueTitle;

    const body = {
        description: "A test event description.",
        location: "Room 101",
        category: "",
        status: "PUBLISHED",
        startDatetime: START_STRING,
        endDatetime: END_STRING,
        capacity: "",
        ...restOverrides,
        name: titleToSearch,
    };

    const res = await agent.post("/events").type("form").send(body);
    if (res.status !== 302) {
        throw new Error(`createEventViaHttp: expected 302, got ${res.status}. Body: ${res.text}`);
    }

    // For published/cancelled/concluded events, search by title to locate the event ID
    const searchRes = await agent.get(`/events/search?q=${encodeURIComponent(titleToSearch)}`);
    const match = searchRes.text.match(/href="\/events\/(\d+)"/);
    if (match) {
        return Number(match[1]);
    }

    // For draft events, check the drafts list
    const draftsRes = await agent.get("/events/drafts");
    const draftsMatch = draftsRes.text.match(/href="\/events\/(\d+)"/);
    if (draftsMatch) {
        return Number(draftsMatch[1]);
    }

    throw new Error(`createEventViaHttp: could not find event ID for title "${titleToSearch}"`);
}

// ── Tests that run in both memory and prisma modes ───────────────────────────
// These tests set up state through HTTP only (no direct service/repo access).

describe.each([["memory"], ["test_prisma"]] as const)("GET /events/:id (%s mode)", (mode) => {
    function buildApp() {
        return createComposedApp(mode, silentLogger).getExpressApp();
    }

    afterEach(() => {
        if (mode === "test_prisma") {
            const db = new BetterSqlite3(path.resolve(process.env.TEST_DB_URL!.replace(/^file:/, "")));
            db.prepare("DELETE FROM RSVP").run();
            db.prepare("DELETE FROM Event").run();
            db.close();
        }
    });

    describe("published events", () => {
        it("returns 200 for an anonymous user viewing a published event", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, { status: "PUBLISHED" });

            const anonAgent = request.agent(app);
            const res = await anonAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(200);
        });

        it("returns 200 for a regular user viewing a published event", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, { status: "PUBLISHED" });

            const userAgent = request.agent(app);
            await loginAs(userAgent, "user@app.test");
            const res = await userAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(200);
        });

        it("returns 200 for a staff user viewing a published event", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, { status: "PUBLISHED" });

            const res = await staffAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(200);
        });

        it("returns 200 for an admin viewing a published event", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, { status: "PUBLISHED" });

            const adminAgent = request.agent(app);
            await loginAs(adminAgent, "admin@app.test");
            const res = await adminAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(200);
        });

        it("renders the event title in the response body", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, {
                status: "PUBLISHED",
                name: "Visible Published Event",
            });

            const anonAgent = request.agent(app);
            const res = await anonAgent.get(`/events/${eventId}`);
            expect(res.text).toContain("Visible Published Event");
        });
    });

    describe("cancelled events", () => {
        it("returns 200 for a cancelled event visible to any user", async () => {
            const app = buildApp();
            const adminAgent = request.agent(app);
            await loginAs(adminAgent, "admin@app.test");
            const eventId = await createEventViaHttp(adminAgent, { status: "PUBLISHED" });

            // Cancel via HTTP
            await adminAgent.post(`/events/${eventId}/cancel`);

            const anonAgent = request.agent(app);
            const res = await anonAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(200);
        });
    });

    describe("missing events", () => {
        it("returns 404 for an event ID that does not exist", async () => {
            const agent = request.agent(buildApp());
            const res = await agent.get("/events/99999");
            expect(res.status).toBe(404);
        });

        it("returns 404 when the event ID is zero", async () => {
            const agent = request.agent(buildApp());
            const res = await agent.get("/events/0");
            expect(res.status).toBe(404);
        });

        it("returns 404 when the event ID is negative", async () => {
            const agent = request.agent(buildApp());
            const res = await agent.get("/events/-1");
            expect(res.status).toBe(404);
        });

        it("returns 404 for a non-numeric event ID", async () => {
            const agent = request.agent(buildApp());
            const res = await agent.get("/events/abc");
            expect(res.status).toBe(404);
        });
    });

    describe("draft visibility", () => {
        it("returns 404 for an anonymous user viewing a draft event", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, { status: "DRAFT" });

            const anonAgent = request.agent(app);
            const res = await anonAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(404);
        });

        it("returns 404 for a regular user viewing a draft event they did not create", async () => {
            const app = buildApp();
            // Staff creates the draft
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, { status: "DRAFT" });

            // Regular user tries to view it
            const userAgent = request.agent(app);
            await loginAs(userAgent, "user@app.test");
            const res = await userAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(404);
        });

        it("returns 200 for the organizer (staff) viewing their own draft event", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, { status: "DRAFT" });

            const res = await staffAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(200);
        });

        it("returns 200 for an admin viewing any draft event", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, { status: "DRAFT" });

            const adminAgent = request.agent(app);
            await loginAs(adminAgent, "admin@app.test");
            const res = await adminAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(200);
        });

        it("does not reveal draft existence — 404 body matches the generic not-found message", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, { status: "DRAFT" });

            const anonAgent = request.agent(app);
            const draftRes = await anonAgent.get(`/events/${eventId}`);
            const missingRes = await anonAgent.get("/events/99999");

            expect(draftRes.status).toBe(404);
            expect(missingRes.status).toBe(404);
            expect(draftRes.text).toContain("Event not found.");
        });
    });

    describe("organizer name display", () => {
        it("shows the organizer's display name when they are the logged-in viewer", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, { status: "PUBLISHED" });

            const res = await staffAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(200);
            expect(res.text).toContain("Sam Staff");
        });
    });

    describe("RSVP and attendee counts", () => {
        it("shows userRsvp when the logged-in user has an active RSVP", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, {
                status: "PUBLISHED",
                capacity: "10",
            });

            const userAgent = request.agent(app);
            await loginAs(userAgent, "user@app.test");
            await userAgent.post(`/events/${eventId}/rsvp/toggle`);

            const res = await userAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(200);
        });

        it("shows no userRsvp for a user who has not RSVP'd", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, {
                status: "PUBLISHED",
                capacity: "10",
            });

            const userAgent = request.agent(app);
            await loginAs(userAgent, "user@app.test");

            const res = await userAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(200);
        });
    });

    describe("HTMX partial render", () => {
        it("returns the event content without the full HTML shell for an HTMX request", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, {
                status: "PUBLISHED",
                name: "HTMX Test Event",
            });

            const anonAgent = request.agent(app);
            const res = await anonAgent
                .get(`/events/${eventId}`)
                .set("HX-Request", "true");
            expect(res.status).toBe(200);
            expect(res.text).toContain("HTMX Test Event");
            expect(res.text).not.toContain("<!doctype html");
        });

        it("returns the full HTML shell for a regular (non-HTMX) request", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, {
                status: "PUBLISHED",
                name: "Full Page Test Event",
            });

            const anonAgent = request.agent(app);
            const res = await anonAgent.get(`/events/${eventId}`);
            expect(res.status).toBe(200);
            expect(res.text).toContain("Full Page Test Event");
            expect(res.text).toContain("<!doctype html");
        });

        it("returns 404 partial (no shell) for an HTMX request to a missing event", async () => {
            const agent = request.agent(buildApp());
            const res = await agent.get("/events/99999").set("HX-Request", "true");
            expect(res.status).toBe(404);
            expect(res.text).not.toContain("<!doctype html");
        });

        it("returns 404 partial (no shell) for an HTMX request to a draft event by a non-organizer", async () => {
            const app = buildApp();
            const staffAgent = request.agent(app);
            await loginAs(staffAgent, "staff@app.test");
            const eventId = await createEventViaHttp(staffAgent, { status: "DRAFT" });

            const anonAgent = request.agent(app);
            const res = await anonAgent
                .get(`/events/${eventId}`)
                .set("HX-Request", "true");
            expect(res.status).toBe(404);
            expect(res.text).not.toContain("<!doctype html");
        });
    });

});

// ── Tests that only run in memory mode (require direct service access) ────────
// These tests exercise state that cannot be reached through HTTP alone
// (e.g. setting organizerId to a different user than the caller, or CONCLUDED status).

describe("GET /events/:id — memory-only tests", () => {
    const FUTURE_START = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const FUTURE_END = new Date(FUTURE_START.getTime() + 60 * 60 * 1000);

    function makeEventData(overrides: Partial<CreateEventData> = {}): CreateEventData {
        return {
            title: "Test Event",
            description: "A test event description.",
            location: "Room 101",
            capacity: null,
            status: "PUBLISHED",
            organizerId: "user-staff",
            startDatetime: FUTURE_START,
            endDatetime: FUTURE_END,
            attendees: [],
            ...overrides,
        };
    }

    // Wire the app manually so the event service and express app share the same repo.
    function buildMemoryApp() {
        const repo = createInMemoryEventRepository();
        const eventService = createEventService(repo, silentLogger);
        const authUsers = CreateInMemoryUserRepository();
        const passwordHasher = CreatePasswordHasher();
        const authService = CreateAuthService(authUsers, passwordHasher);
        const adminUserService = CreateAdminUserService(authUsers, passwordHasher);
        const authController = CreateAuthController(authService, adminUserService, silentLogger);
        const eventController = createEventController(eventService, silentLogger);
        const expressApp = CreateApp(eventController, authController, silentLogger, eventService).getExpressApp();
        return { expressApp, eventService };
    }

    async function createEvent(
        service: ReturnType<typeof buildMemoryApp>["eventService"],
        overrides: Partial<CreateEventData> = {}
    ) {
        const result = await service.createEvent(makeEventData(overrides));
        if (!result.ok) throw new Error(`Test setup failed: ${result.value.message}`);
        return result.value;
    }

    it("returns 404 for a non-organizer staff user viewing another organizer's draft", async () => {
        const { expressApp, eventService } = buildMemoryApp();
        // Event organized by admin; viewed by staff (different user)
        const event = await createEvent(eventService, { status: "DRAFT", organizerId: "user-admin" });
        const agent = request.agent(expressApp);
        await loginAs(agent, "staff@app.test");

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(404);
    });

    it("shows the organizer ID (not display name) when a different user views the event", async () => {
        const { expressApp, eventService } = buildMemoryApp();
        const event = await createEvent(eventService, { status: "PUBLISHED", organizerId: "user-staff" });
        const agent = request.agent(expressApp);
        await loginAs(agent, "user@app.test");

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain("user-staff");
    });

    it("reflects the correct goingCount for an event with attendees", async () => {
        const { expressApp, eventService } = buildMemoryApp();
        const event = await createEvent(eventService, { status: "PUBLISHED", capacity: 10 });
        await eventService.toggleRsvp(event.id, "user-reader", "user");
        await eventService.toggleRsvp(event.id, "user-staff", "user");

        const agent = request.agent(expressApp);
        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain("2");
    });

    it("returns 200 with queue position info for a waitlisted user", async () => {
        const { expressApp, eventService } = buildMemoryApp();
        // Capacity 1 so the second RSVPer is waitlisted
        const event = await createEvent(eventService, { status: "PUBLISHED", capacity: 1 });
        await eventService.toggleRsvp(event.id, "user-admin", "user");   // GOING
        await eventService.toggleRsvp(event.id, "user-reader", "user");  // WAITLISTED

        const agent = request.agent(expressApp);
        await loginAs(agent, "user@app.test"); // user-reader

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
    });

    it("returns 200 for a concluded event", async () => {
        const { expressApp, eventService } = buildMemoryApp();

        const result = await eventService.createEvent(makeEventData({
            status: "CONCLUDED" as CreateEventData["status"],
        }));
        if (!result.ok) throw new Error(`Test setup failed: ${result.value.message}`);
        const concludedEvent = result.value;

        const agent = request.agent(expressApp);
        const res = await agent.get(`/events/${concludedEvent.id}`);
        expect(res.status).toBe(200);
    });

    it("returns 200 for the pre-seeded published event (ID 1)", async () => {
        const app = createComposedApp("memory", silentLogger).getExpressApp();
        const agent = request.agent(app);
        const res = await agent.get("/events/1");
        expect(res.status).toBe(200);
        expect(res.text).toContain("Team Kickoff 2026");
    });
});
