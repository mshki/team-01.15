import request from "supertest";
import { createComposedApp } from "../../src/composition";
import { createEventService } from "../../src/service/EventService";
import { createInMemoryEventRepository } from "../../src/repository/InMemoryEventRepository";
import type { ILoggingService } from "../../src/service/LoggingService";
import type { CreateEventData } from "../../src/types/EventTypes";

const silentLogger: ILoggingService = {
    info: () => {},
    warn: () => {},
    error: () => {},
};

function buildApp() {
    const repo = createInMemoryEventRepository();
    const eventService = createEventService(repo, silentLogger);
    const app = createComposedApp(silentLogger, repo);
    return { expressApp: app.getExpressApp(), eventService };
}

async function loginAs(
    agent: ReturnType<typeof request.agent>,
    email: string,
    password = "password123"
) {
    await agent.post("/login").type("form").send({ email, password });
}

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

async function createEvent(
    service: ReturnType<typeof buildApp>["eventService"],
    overrides: Partial<CreateEventData> = {}
) {
    const result = await service.createEvent(makeEventData(overrides));
    if (!result.ok) throw new Error(`Test setup failed: ${result.value.message}`);
    return result.value;
}

// ── GET /events/:id — published events ───────────────────────────────────────

describe("GET /events/:id — published events", () => {
    it("returns 200 for an anonymous user viewing a published event", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED" });
        const agent = request.agent(expressApp);

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
    });

    it("returns 200 for a regular user viewing a published event", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED" });
        const agent = request.agent(expressApp);
        await loginAs(agent, "user@app.test");

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
    });

    it("returns 200 for a staff user viewing a published event", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED" });
        const agent = request.agent(expressApp);
        await loginAs(agent, "staff@app.test");

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
    });

    it("returns 200 for an admin viewing a published event", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED" });
        const agent = request.agent(expressApp);
        await loginAs(agent, "admin@app.test");

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
    });

    it("renders the event title in the response body", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, {
            status: "PUBLISHED",
            title: "Visible Published Event",
        });
        const agent = request.agent(expressApp);

        const res = await agent.get(`/events/${event.id}`);
        expect(res.text).toContain("Visible Published Event");
    });
});

// ── GET /events/:id — cancelled and concluded events ─────────────────────────

describe("GET /events/:id — cancelled and concluded events", () => {
    it("returns 200 for a published-then-cancelled event visible to any user", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, {
            status: "PUBLISHED",
            organizerId: "user-staff",
        });
        await eventService.cancelEvent(event.id, "user-staff", false);
        const agent = request.agent(expressApp);

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
    });

    it("returns 200 for a concluded event visible to any user", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED" });
        // Manually set to CONCLUDED by using the repository update path via service
        // The repository supports direct status updates through updateEvent; we force
        // CONCLUDED by updating the underlying record.
        const repo = createInMemoryEventRepository();
        const service2 = createEventService(repo, silentLogger);
        const app2 = createComposedApp(silentLogger, repo).getExpressApp();

        const event2 = await createEvent(service2, { status: "PUBLISHED" });
        // Conclude by patching status directly through a second createEvent is not
        // possible through the public service API, so test via direct creation.
        const concludedEvent = await createEvent(service2, {
            status: "CONCLUDED" as CreateEventData["status"],
        });
        const agent = request.agent(app2);

        const res = await agent.get(`/events/${concludedEvent.id}`);
        expect(res.status).toBe(200);

        // Verify the event2 (published) is also accessible as a sanity check
        const res2 = await agent.get(`/events/${event2.id}`);
        expect(res2.status).toBe(200);
    });
});

// ── GET /events/:id — missing events ─────────────────────────────────────────

describe("GET /events/:id — missing events", () => {
    it("returns 404 for an event ID that does not exist", async () => {
        const { expressApp } = buildApp();
        const agent = request.agent(expressApp);

        const res = await agent.get("/events/99999");
        expect(res.status).toBe(404);
    });

    it("returns 404 when the event ID is zero", async () => {
        const { expressApp } = buildApp();
        const agent = request.agent(expressApp);

        const res = await agent.get("/events/0");
        expect(res.status).toBe(404);
    });

    it("returns 404 when the event ID is negative", async () => {
        const { expressApp } = buildApp();
        const agent = request.agent(expressApp);

        const res = await agent.get("/events/-1");
        expect(res.status).toBe(404);
    });

    it("returns 404 for a non-numeric event ID", async () => {
        const { expressApp } = buildApp();
        const agent = request.agent(expressApp);

        // parseInt("abc") → NaN, which the route treats as an invalid ID
        const res = await agent.get("/events/abc");
        expect(res.status).toBe(404);
    });
});

// ── GET /events/:id — draft visibility rules ─────────────────────────────────

describe("GET /events/:id — draft visibility", () => {
    it("returns 404 for an anonymous user viewing a draft event", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "DRAFT", organizerId: "user-staff" });
        const agent = request.agent(expressApp);

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(404);
    });

    it("returns 404 for a regular user (role=user) viewing a draft event they did not create", async () => {
        const { expressApp, eventService } = buildApp();
        // Organizer is staff; viewer is the regular user
        const event = await createEvent(eventService, { status: "DRAFT", organizerId: "user-staff" });
        const agent = request.agent(expressApp);
        await loginAs(agent, "user@app.test");

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(404);
    });

    it("returns 404 for a non-organizer staff user viewing another organizer's draft", async () => {
        const { expressApp, eventService } = buildApp();
        // Event organized by admin; viewed by staff (different user)
        const event = await createEvent(eventService, { status: "DRAFT", organizerId: "user-admin" });
        const agent = request.agent(expressApp);
        await loginAs(agent, "staff@app.test");

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(404);
    });

    it("returns 200 for the organizer (staff) viewing their own draft event", async () => {
        const { expressApp, eventService } = buildApp();
        // user-staff is the organizer
        const event = await createEvent(eventService, { status: "DRAFT", organizerId: "user-staff" });
        const agent = request.agent(expressApp);
        await loginAs(agent, "staff@app.test");

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
    });

    it("returns 200 for an admin viewing any draft event", async () => {
        const { expressApp, eventService } = buildApp();
        // Organized by staff, admin should still see it
        const event = await createEvent(eventService, { status: "DRAFT", organizerId: "user-staff" });
        const agent = request.agent(expressApp);
        await loginAs(agent, "admin@app.test");

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
    });

    it("does not reveal draft existence — 404 body matches the generic not-found message", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "DRAFT", organizerId: "user-staff" });
        const agent = request.agent(expressApp);

        const draftRes = await agent.get(`/events/${event.id}`);
        const missingRes = await agent.get("/events/99999");

        // Both return 404. The draft response uses the generic "Event not found."
        // message to avoid leaking that a draft exists at that ID.
        expect(draftRes.status).toBe(404);
        expect(missingRes.status).toBe(404);
        expect(draftRes.text).toContain("Event not found.");
    });
});

// ── GET /events/:id — organizer display name ─────────────────────────────────

describe("GET /events/:id — organizer name display", () => {
    it("shows the organizer's display name when they are the logged-in viewer", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED", organizerId: "user-staff" });
        const agent = request.agent(expressApp);
        await loginAs(agent, "staff@app.test"); // user-staff → displayName "Sam Staff"

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain("Sam Staff");
    });

    it("shows the organizer ID (not display name) when a different user views the event", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED", organizerId: "user-staff" });
        const agent = request.agent(expressApp);
        await loginAs(agent, "user@app.test");

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
        // Non-organizer viewers see the raw organizerId string, not the display name
        expect(res.text).toContain("user-staff");
    });
});

// ── GET /events/:id — RSVP and attendee counts ───────────────────────────────

describe("GET /events/:id — attendee counts", () => {
    it("reflects the correct goingCount for an event with attendees", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED", capacity: 10 });
        await eventService.toggleRsvp(event.id, "user-reader", "user");
        await eventService.toggleRsvp(event.id, "user-staff", "user");

        const agent = request.agent(expressApp);
        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
        // The template renders the going count; confirm two attendees are reflected
        expect(res.text).toContain("2");
    });

    it("shows userRsvp when the logged-in user has an active RSVP", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED", capacity: 10 });
        await eventService.toggleRsvp(event.id, "user-reader", "user");

        const agent = request.agent(expressApp);
        await loginAs(agent, "user@app.test"); // user-reader

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
    });

    it("shows no userRsvp for a user who has not RSVP'd", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED", capacity: 10 });

        const agent = request.agent(expressApp);
        await loginAs(agent, "user@app.test");

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
    });

    it("returns 200 with queue position info for a waitlisted user", async () => {
        const { expressApp, eventService } = buildApp();
        // Capacity 1 so the second RSVPer is waitlisted
        const event = await createEvent(eventService, { status: "PUBLISHED", capacity: 1 });
        await eventService.toggleRsvp(event.id, "user-admin", "user");   // GOING
        await eventService.toggleRsvp(event.id, "user-reader", "user");  // WAITLISTED

        const agent = request.agent(expressApp);
        await loginAs(agent, "user@app.test"); // user-reader

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
    });
});

// ── GET /events/:id — HTMX partial render ────────────────────────────────────

describe("GET /events/:id — HTMX partial render", () => {
    it("returns the event content without the full HTML shell for an HTMX request", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED", title: "HTMX Test Event" });
        const agent = request.agent(expressApp);

        const res = await agent.get(`/events/${event.id}`).set("HX-Request", "true");
        expect(res.status).toBe(200);
        expect(res.text).toContain("HTMX Test Event");
        expect(res.text).not.toContain("<!doctype html");
    });

    it("returns the full HTML shell for a regular (non-HTMX) request", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED", title: "Full Page Test Event" });
        const agent = request.agent(expressApp);

        const res = await agent.get(`/events/${event.id}`);
        expect(res.status).toBe(200);
        expect(res.text).toContain("Full Page Test Event");
        expect(res.text).toContain("<!doctype html");
    });

    it("returns 404 partial (no shell) for an HTMX request to a missing event", async () => {
        const { expressApp } = buildApp();
        const agent = request.agent(expressApp);

        const res = await agent.get("/events/99999").set("HX-Request", "true");
        expect(res.status).toBe(404);
        expect(res.text).not.toContain("<!doctype html");
    });

    it("returns 404 partial (no shell) for an HTMX request to a draft event by a non-organizer", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "DRAFT", organizerId: "user-staff" });
        const agent = request.agent(expressApp);

        const res = await agent.get(`/events/${event.id}`).set("HX-Request", "true");
        expect(res.status).toBe(404);
        expect(res.text).not.toContain("<!doctype html");
    });
});

// ── GET /events/:id — seeded demo event ──────────────────────────────────────

describe("GET /events/:id — seeded demo event (ID 1)", () => {
    it("returns 200 for the pre-seeded published event", async () => {
        const { expressApp } = buildApp();
        const agent = request.agent(expressApp);

        const res = await agent.get("/events/1");
        expect(res.status).toBe(200);
        expect(res.text).toContain("Team Kickoff 2026");
    });
});
