import request from "supertest";
import { createEventController } from "../../src/controllers/EventController";
import { createEventService } from "../../src/service/EventService";
import { createInMemoryEventRepository } from "../../src/repository/InMemoryEventRepository";
import { CreateInMemoryUserRepository } from "../../src/auth/InMemoryUserRepository";
import { CreatePasswordHasher } from "../../src/auth/PasswordHasher";
import { CreateAuthService } from "../../src/auth/AuthService";
import { CreateAdminUserService } from "../../src/auth/AdminUserService";
import { CreateAuthController } from "../../src/auth/AuthController";
import { CreateApp } from "../../src/app";
import type { ILoggingService } from "../../src/service/LoggingService";
import type { CreateEventData, IEvent } from "../../src/types/EventTypes";

const silentLogger: ILoggingService = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function buildAppWithDeps() {
  const repo = createInMemoryEventRepository();
  const eventService = createEventService(repo, silentLogger);
  const eventController = createEventController(eventService, silentLogger);
  const authUsers = CreateInMemoryUserRepository();
  const passwordHasher = CreatePasswordHasher();
  const authService = CreateAuthService(authUsers, passwordHasher);
  const adminUserService = CreateAdminUserService(authUsers, passwordHasher);
  const authController = CreateAuthController(authService, adminUserService, silentLogger);
  const app = CreateApp(eventController, authController, silentLogger, eventService);
  return { app: app.getExpressApp(), eventService };
}

async function loginAs(
  agent: ReturnType<typeof request.agent>,
  email: string,
  password = "password123"
) {
  await agent.post("/login").type("form").send({ email, password });
}

function makeEventData(overrides: Partial<CreateEventData> = {}): CreateEventData {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    title: "Lifecycle Test Event",
    description: "Lifecycle test event description.",
    location: "Campus Center",
    category: "general",
    status: "DRAFT",
    organizerId: "user-staff",
    startDatetime: start,
    endDatetime: end,
    capacity: 25,
    attendees: [],
    ...overrides,
  };
}

async function createEventForTest(
  eventService: ReturnType<typeof buildAppWithDeps>["eventService"],
  overrides: Partial<CreateEventData> = {}
): Promise<IEvent> {
  const data = makeEventData(overrides);
  const session = { userId: data.organizerId, email: "staff@app.test", displayName: "Sam Staff", role: "staff" as const, signedInAt: new Date().toISOString() };
  const result = await eventService.createEvent(session, data);
  if (!result.ok) {
    throw new Error(`Failed to create test event: ${result.value.message}`);
  }
  return result.value;
}

describe("POST /events/:id/publish", () => {
  it("publishes a draft event for the organizer", async () => {
    const { app, eventService } = buildAppWithDeps();
    const event = await createEventForTest(eventService, {
      status: "DRAFT",
      organizerId: "user-staff",
    });

    const agent = request.agent(app);
    await loginAs(agent, "staff@app.test");

    const res = await agent.post(`/events/${event.id}/publish`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("Published");
  });

  it("rejects publish for a non-organizer", async () => {
    const { app, eventService } = buildAppWithDeps();
    const event = await createEventForTest(eventService, {
      status: "DRAFT",
      organizerId: "user-staff",
    });

    const agent = request.agent(app);
    await loginAs(agent, "admin@app.test");

    const res = await agent.post(`/events/${event.id}/publish`);

    expect(res.status).toBe(400);
    expect(res.text).toContain("Only the organizer can publish this event");
  });

  it("rejects publishing an already published event", async () => {
    const { app, eventService } = buildAppWithDeps();
    const event = await createEventForTest(eventService, {
      status: "PUBLISHED",
      organizerId: "user-staff",
    });

    const agent = request.agent(app);
    await loginAs(agent, "staff@app.test");

    const res = await agent.post(`/events/${event.id}/publish`);

    expect(res.status).toBe(400);
    expect(res.text).toContain("Only draft events can be published");
  });
});

describe("POST /events/:id/cancel", () => {
  it("cancels a published event for the organizer", async () => {
    const { app, eventService } = buildAppWithDeps();
    const event = await createEventForTest(eventService, {
      status: "PUBLISHED",
      organizerId: "user-staff",
    });

    const agent = request.agent(app);
    await loginAs(agent, "staff@app.test");

    const res = await agent.post(`/events/${event.id}/cancel`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("Cancelled");
  });

  it("allows an admin to cancel another user's published event", async () => {
    const { app, eventService } = buildAppWithDeps();
    const event = await createEventForTest(eventService, {
      status: "PUBLISHED",
      organizerId: "user-staff",
    });

    const agent = request.agent(app);
    await loginAs(agent, "admin@app.test");

    const res = await agent.post(`/events/${event.id}/cancel`);

    expect(res.status).toBe(200);
    expect(res.text).toContain("Cancelled");
  });

  it("rejects cancel for a non-admin non-organizer", async () => {
    const { app, eventService } = buildAppWithDeps();
    const event = await createEventForTest(eventService, {
      status: "PUBLISHED",
      organizerId: "user-staff",
    });

    const agent = request.agent(app);
    await loginAs(agent, "user@app.test");

    const res = await agent.post(`/events/${event.id}/cancel`);

    expect(res.status).toBe(400);
    expect(res.text).toContain("Only the organizer or an admin can cancel this event");
  });

  it("rejects cancel when the event is not published", async () => {
    const { app, eventService } = buildAppWithDeps();
    const event = await createEventForTest(eventService, {
      status: "DRAFT",
      organizerId: "user-staff",
    });

    const agent = request.agent(app);
    await loginAs(agent, "staff@app.test");

    const res = await agent.post(`/events/${event.id}/cancel`);

    expect(res.status).toBe(400);
    expect(res.text).toContain("Only published events can be cancelled");
  });
});

describe("event lifecycle HTMX responses", () => {
  it("returns lifecycle partial HTML for HTMX publish requests", async () => {
    const { app, eventService } = buildAppWithDeps();
    const event = await createEventForTest(eventService, {
      status: "DRAFT",
      organizerId: "user-staff",
    });

    const agent = request.agent(app);
    await loginAs(agent, "staff@app.test");

    const res = await agent
      .post(`/events/${event.id}/publish`)
      .set("HX-Request", "true");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Published");
    expect(res.text).not.toContain("<html");
  });

  it("returns lifecycle partial HTML for HTMX cancel requests", async () => {
    const { app, eventService } = buildAppWithDeps();
    const event = await createEventForTest(eventService, {
      status: "PUBLISHED",
      organizerId: "user-staff",
    });

    const agent = request.agent(app);
    await loginAs(agent, "staff@app.test");

    const res = await agent
      .post(`/events/${event.id}/cancel`)
      .set("HX-Request", "true");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Cancelled");
    expect(res.text).not.toContain("<html");
  });
});