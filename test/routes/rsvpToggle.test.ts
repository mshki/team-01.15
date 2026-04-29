import request from "supertest";
import { createComposedApp } from "../../src/composition";
import type { ILoggingService } from "../../src/service/LoggingService";
import { CreateEventData } from "../../src/types/EventTypes";


const silentLogger: ILoggingService = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function buildApp(mode: "memory" | "prisma" | "test_prisma") {
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
describe("memory repo tests RSVP toggle", () => {
  let app: ReturnType<typeof buildApp>;
  let agent: ReturnType<typeof request.agent>;

  beforeEach(() => {
    app = buildApp("memory");
    agent = request.agent(app);
  });

  it("returns 200 and swaps the RSVP panel on a successful toggle", async () => {
    await loginAs(agent, "staff@app.test");

    await createEvent(agent, {
      capacity: 2,
    });

    await loginAs(agent, "user@app.test");

    const res = await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(200);
    expect(res.text).toContain("Your RSVP");
    expect(res.text).toMatch(/Cancel RSVP|RSVP to this event|Reactivate RSVP/);
  });

  it("places a new user on the waitlist when capacity is full", async () => {
    await loginAs(agent, "admin@app.test");

    await createEvent(agent, {
      capacity: 1,
    });

    await loginAs(agent, "staff@app.test");
    const staff_rsvp = await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(staff_rsvp.status).toBe(200);
    expect(staff_rsvp.text).toMatch(/Cancel RSVP|RSVP to this event|Reactivate RSVP/);
    
    await loginAs(agent, "user@app.test");

    const res = await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/waitlist|WAITLISTED/i);
  });

  it("cancels an existing GOING RSVP and updates the response inline", async () => {
    await loginAs(agent, "admin@app.test");

    await createEvent(agent, {
      capacity: 2,
    });

    await loginAs(agent, "user@app.test");
    await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    const res = await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(200);
    expect(res.text).toContain("Your RSVP");
    expect(res.text).toMatch(/Reactivate RSVP/);
  });

  it("returns 403 for an admin trying to RSVP", async () => {
    await loginAs(agent, "admin@app.test");
    await createEvent(agent);

    const res = await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(403);
    expect(res.text).toMatch(/Only members can RSVP/i);
  });

  it("returns an error when the organizer tries to RSVP their own event", async () => {
    await loginAs(agent, "staff@app.test");
    await createEvent(agent);

    const res = await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(403);
    expect(res.text).toMatch(/organizers cannot RSVP/i);
  });

  it("returns an error for cancelled events", async () => {
    await loginAs(agent, "staff@app.test");
    await createEvent(agent, {
      status: "CANCELLED",
    });

    await loginAs(agent, "user@app.test");

    const res = await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(404);
    expect(res.text).toMatch(/Cancelled events cannot receive RSVPs/i);
  });

  it("returns an error for concluded events", async () => {
    await loginAs(agent, "staff@app.test");
    await createEvent(agent, {
      status: "CONCLUDED",
    });

    await loginAs(agent, "user@app.test");

    const res = await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

      expect(res.status).toBe(404);
    expect(res.text).toMatch(/Concluded events cannot receive RSVPs/i);
  });

  it("returns an error for past events", async () => {
    await loginAs(agent, "staff@app.test");
    await createEvent(agent, {
      startDatetime: new Date(Date.now() - 172800000),
      endDatetime: new Date(Date.now() - 86400000)
    });

    await loginAs(agent, "user@app.test");

    const res = await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

      expect(res.status).toBe(404);
    expect(res.text).toMatch(/Past events cannot receive RSVPs/i);
  });

  it("reactivates a cancelled RSVP", async () => {
    await loginAs(agent, "staff@app.test");
    await createEvent(agent, {
      capacity: 2,
    });

    await loginAs(agent, "user@app.test");

    // rsvp
    await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    // cancel
    await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    // reactivate
    const res = await agent
      .post("/events/2/rsvp/toggle")
      .set("HX-Request", "true")
      .send();

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Cancel RSVP/i);
  });
});