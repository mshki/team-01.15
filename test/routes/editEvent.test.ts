import request from "supertest";
import { createComposedApp } from "../../src/composition";
import type { ILoggingService } from "../../src/service/LoggingService";
import { CreateEventData } from "../../src/types/EventTypes";

const silentLogger: ILoggingService = {
    info: () => {},
    warn: () => {},
    error: () => {},
};

function buildApp(mode: "memory" | "prisma") {
    const app = createComposedApp(mode, silentLogger);
    return app.getExpressApp();
}

async function loginAs(
    agent: ReturnType<typeof request.agent>,
    email: string,
    password = "password123"
) {
    await agent.post("/login").type("form").send({ email, password });
}

const START_STRING = "2030-06-01T10:00";
const END_STRING   = "2030-06-01T12:00";

const FUTURE_START = new Date(Date.now() + 24 * 60 * 60 * 1000);
const FUTURE_END = new Date(FUTURE_START.getTime() + 60 * 60 * 1000);

async function createEvent(
    agent: any,
    overrides: Partial<CreateEventData> = {},
  ) {
    const response = await agent
      .post("/events")
      .type("form")
      .send({
        name: "Test Event",
        description: "A test event description.",
        location: "Room 101",
        category: "",
        status: "PUBLISHED",
        startDatetime: START_STRING,
        endDatetime: END_STRING,
        capacity: "",
        ...overrides,
    });

    expect(response.status).toBe(302);
  }

describe("memory repo tests event editing", () => {
    it("returns the edit form for organizer", async () => {
        const app = buildApp("memory");
        const agent = request.agent(app);
        await loginAs(agent, "staff@app.test");

        await createEvent(agent);

        const res = await agent.get(`/events/2/edit`);
        expect(res.status).toBe(200);
        expect(res.text).toContain("Edit Event");
    });

    it("returns the edit form for admin", async () => {
        const app = buildApp("memory");
        const agent = request.agent(app);
        await loginAs(agent, "admin@app.test");
        
        await createEvent(agent);

        const res = await agent.get(`/events/2/edit`);
        expect(res.status).toBe(200);
        expect(res.text).toContain("Edit Event");
    });

    it("rejects members from accessing edit form", async () => {
        const app = buildApp("memory");
        let agent = request.agent(app);
        await loginAs(agent, "admin@app.test");
        await createEvent(agent);

        await loginAs(agent, "user@app.test");

        const res = await agent.get(`/events/2/edit`);
        expect(res.status).toBe(403);
        expect(res.text).toContain("Need permission to edit this event.");
    });

    it("return 404 in the case of event not found", async () => {
        const app = buildApp("memory");
        const agent = request.agent(app);

        await loginAs(agent, "admin@app.test");

        const res = await agent.get("/events/999/edit");
        expect(res.status).toBe(404);
        expect(res.text).toContain("Event 999 not found.");
    });

    // TODO: Confirm whether cancelled + concluded should be error code 409 or 400..

    it("return 400 in the case of cancelled events", async () => {
        const app = buildApp("memory");
        const agent = request.agent(app);

        await loginAs(agent, "admin@app.test");
        await createEvent(agent);

        const res = await agent.post(`/events/2/cancel`)
        expect(res.status).toBe(200);
        const edit_res = await agent.get(`/events/2/edit`);
        expect(edit_res.status).toBe(400);
    });

    it("return 400 in the case of concluded events", async () => {
        const app = buildApp("memory");
        const agent = request.agent(app);

        await loginAs(agent, "admin@app.test");

        await createEvent(agent);

        await agent
            .post(`/events/2/edit`)
            .type("form")
            .send({
                name: "Concluded Event",
                description: "This should work",
                location: "No room",
                category: "",
                status: "CONCLUDED",
                startDatetime: START_STRING,
                endDatetime: END_STRING,
                capacity: ""
            });

        const res = await agent.get(`/events/2/edit`);
        expect(res.status).toBe(400);
        expect(res.text).toContain("Cancelled or concluded events cannot be edited.");
    });

    it("successful edit updates and sets HX-Location", async () => {
        const app = buildApp("memory");
        const agent = request.agent(app);

        await loginAs(agent, "admin@app.test");
        await createEvent(agent);


        const res = await agent
        .post(`/events/2/edit`)
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
        const app = buildApp("memory");
        const agent = request.agent(app);

        await loginAs(agent, "admin@app.test");
        await createEvent(agent);

        const res = await agent
        .post(`/events/2/edit`)
        .type("form")
        .send({
            name: "",
        });

        expect(res.status).toBe(400);
    });
});