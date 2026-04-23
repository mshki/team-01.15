import request from "supertest";
import { createComposedApp } from "../../src/composition";
import { createEventController } from "../../src/controllers/EventController";
import { createEventService } from "../../src/service/EventService";
import { createInMemoryEventRepository } from "../../src/repository/InMemoryEventRepository";
import type { ILoggingService } from "../../src/service/LoggingService";
import { CreateEventData } from "../../src/types/EventTypes";

// Reused from eventDetails.test.ts
const silentLogger: ILoggingService = {
    info: () => {},
    warn: () => {},
    error: () => {},
};

function buildApp() {
    const repo = createInMemoryEventRepository();
    const eventService = createEventService(repo, silentLogger);
    const controller = createEventController(eventService, silentLogger);
    const app = createComposedApp(controller, silentLogger);
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
// End reused

describe("event editing", () => {
    it("returns the edit form for organizer", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED" });
        const agent = request.agent(expressApp);

        await loginAs(agent, "staff@app.test");

        const res = await agent.get(`/events/${event.id}/edit`);
        expect(res.status).toBe(200);
        expect(res.text).toContain("Edit Event");
    });

    it("returns the edit form for admin", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED" });
        const agent = request.agent(expressApp);

        await loginAs(agent, "admin@app.test");

        const res = await agent.get(`/events/${event.id}/edit`);
        expect(res.status).toBe(200);
        expect(res.text).toContain("Edit Event");
    });

    it("rejects members from accessing edit form", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED" });
        const agent = request.agent(expressApp);

        await loginAs(agent, "user@app.test");

        const res = await agent.get(`/events/${event.id}/edit`);
        expect(res.status).toBe(403);
        expect(res.text).toContain("Need permission to edit this event.");
    });

    it("return 404 in the case of event not found", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED" });
        const agent = request.agent(expressApp);

        await loginAs(agent, "admin@app.test");

        const res = await agent.get("/events/999/edit");
        expect(res.status).toBe(404);
        expect(res.text).toContain("Event 999 not found.");
    });

    // TODO: Confirm whether cancelled + concluded should be error code 409 or 400..

    it("return 400 in the case of cancelled events", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED" });
        const agent = request.agent(expressApp);

        await loginAs(agent, "admin@app.test");

        const res = await agent.post(`/events/${event.id}/cancel`)
        expect(res.status).toBe(200);
        const edit_res = await agent.get(`/events/${event.id}/edit`);
        expect(edit_res.status).toBe(400);
    });

    it("return 400 in the case of concluded events", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, {status: "PUBLISHED"});
        const agent = request.agent(expressApp);

        await loginAs(agent, "admin@app.test");
        const smt = await agent
        .post(`/events/${event.id}/edit`)
        .type("form")
        .send({
            name: event.title,
            description: event.description,
            location: event.location,
            category: event.category,
            startDatetime: "2025-04-21T10:00:00.000Z",
            endDatetime: "2025-04-22T11:00:00.000Z",
            capacity: event.capacity,
            status: "CONCLUDED",
        });

        const res = await agent.get(`/events/${event.id}/edit`);
        expect(res.status).toBe(400);
        expect(res.text).toContain("Cancelled or concluded events cannot be edited.");
    });

    it("successful edit updates and sets HX-Location", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED" });
        const agent = request.agent(expressApp);

        await loginAs(agent, "admin@app.test");

        const res = await agent
        .post(`/events/${event.id}/edit`)
        .type("form")
        .send({
            name: "better name",
            description: "updated description",
            location: "ILC somewhere",
            category: "none",
            startDatetime: FUTURE_START,
            endDatetime: FUTURE_END,
            capacity: 50,
            status: "DRAFT",
        });

        expect(res.status).toBe(200);
        expect(res.headers["hx-redirect"]).toBe('/events');
    });

    it("return 400 upon invalid edit input", async () => {
        const { expressApp, eventService } = buildApp();
        const event = await createEvent(eventService, { status: "PUBLISHED" });
        const agent = request.agent(expressApp);

        await loginAs(agent, "admin@app.test");

        const res = await agent
        .post(`/events/${event.id}/edit`)
        .type("form")
        .send({
            name: "",
        });

        expect(res.status).toBe(400);
    });
});