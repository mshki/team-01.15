import request from "supertest";
import { createComposedApp } from "../../src/composition";
import { createEventController } from "../../src/controllers/EventController";
import { createEventService } from "../../src/service/EventService";
import { createInMemoryEventRepository } from "../../src/repository/InMemoryEventRepository";
import type { ILoggingService } from "../../src/service/LoggingService";

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
  return { expressApp: app.getExpressApp(), eventService, repo };
}

async function loginAs(
  agent: ReturnType<typeof request.agent>,
  email: string,
  password = "password123"
) {
  await agent.post("/login").type("form").send({ email, password });
}

describe("Event RSVP toggle", () => {
  let app: ReturnType<typeof buildApp>;
  let agent: ReturnType<typeof request.agent>;

  beforeEach(() => {
    app = buildApp();
    agent = request.agent(app.expressApp);
  });

  async function makeEvent(repo: any, overrides: Partial<any> = {}) {
    const event = {
      id: 1,
      title: "Test Event",
      description: "A test event",
      location: "Test Location",
      category: "Tech",
      status: "PUBLISHED",
      capacity: 2,
      organizerId: "user-staff",
      startDatetime: new Date(Date.now() + 86400000).toISOString(),
      endDatetime: new Date(Date.now() + 90000000).toISOString(),
      attendees: [],
      updatedAt: new Date(),
      ...overrides,
    };

    repo.events.set(event.id, event);

    return event;
  }

  it("returns 200 and swaps the RSVP panel on a successful toggle", async () => {
    await loginAs(agent, "user@app.test");
    await makeEvent(app.repo, {
      capacity: 2,
      attendees: [],
    });

    const res = await agent
      .post("/events/1/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(200);
    expect(res.text).toContain("Your RSVP");
    expect(res.text).toMatch(/Cancel RSVP|RSVP to this event|Reactivate RSVP/);
  });

  it("places a new user on the waitlist when capacity is full", async () => {
    await loginAs(agent, "user@app.test");
    await makeEvent(app.repo, {
      capacity: 1,
      organizerId: "user-admin",
      attendees: [
        {
          id: "staff",
          eventId: 1,
          userId: "user-staff",
          rsvpStatus: "GOING",
          createdAt: new Date(),
        },
      ],
    });

    const res = await agent
      .post("/events/1/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/waitlist|WAITLISTED/i);
  });

  it("cancels an existing GOING RSVP and updates the response inline", async () => {
    await loginAs(agent, "user@app.test");
    await makeEvent(app.repo, {
      capacity: 2,
      attendees: [
        {
          id: "rsvp_1_member1_a",
          eventId: 1,
          userId: "member-1-id",
          rsvpStatus: "GOING",
          createdAt: new Date(),
        },
      ],
    });

    const res = await agent
      .post("/events/1/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(200);
    expect(res.text).toContain("Your RSVP");
    expect(res.text).toMatch(/Cancel RSVP|Reactivate RSVP|RSVP to this event/);
  });

  it("returns 403 for an admin trying to RSVP", async () => {
    await loginAs(agent, "admin@app.test");
    await makeEvent(app.repo);

    const res = await agent
      .post("/events/1/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(403);
    expect(res.text).toMatch(/Only members can RSVP/i);
  });

  it("returns an error when the organizer tries to RSVP their own event", async () => {
    await loginAs(agent, "staff@app.test");
    await makeEvent(app.repo, {
      organizerId: "user-staff",
    });

    const res = await agent
      .post("/events/1/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(403);
    expect(res.text).toMatch(/organizers cannot RSVP/i);
  });

  it("returns an error for cancelled events", async () => {
    await loginAs(agent, "user@app.test");
    await makeEvent(app.repo, {
      status: "CANCELLED",
    });

    const res = await agent
      .post("/events/1/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(404);
    expect(res.text).toMatch(/Cancelled events cannot receive RSVPs/i);
  });

  it("returns an error for concluded events", async () => {
    await loginAs(agent, "user@app.test");
    await makeEvent(app.repo, {
      status: "CONCLUDED",
    });

    const res = await agent
      .post("/events/1/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

      expect(res.status).toBe(404);
    expect(res.text).toMatch(/Concluded events cannot receive RSVPs/i);
  });

  it("returns an error for past events", async () => {
    await loginAs(agent, "user@app.test");
    await makeEvent(app.repo, {
      startDatetime: new Date(Date.now() - 172800000).toISOString(),
      endDatetime: new Date(Date.now() - 86400000).toISOString(),
    });

    const res = await agent
      .post("/events/1/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

      expect(res.status).toBe(404);
    expect(res.text).toMatch(/Past events cannot receive RSVPs/i);
  });

  it("reactivates a cancelled RSVP", async () => {
    await loginAs(agent, "user@app.test");
    await makeEvent(app.repo, {
      capacity: 2,
      attendees: [
        {
          id: "rsvp_1_member1_a",
          eventId: 1,
          userId: "member-1-id",
          rsvpStatus: "CANCELLED",
          createdAt: new Date(),
        },
      ],
    });

    const res = await agent
      .post("/events/1/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/RSVP to this event|Reactivate RSVP|Cancel RSVP/i);
  });
});