import request from "supertest";
import { createComposedApp } from "../../src/composition";
import type { ILoggingService } from "../../src/service/LoggingService";

const silentLogger: ILoggingService = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// `createComposedApp` owns the repo/service/controller wiring internally and
// only takes the mode + logger. Match the pattern used by rsvpToggle.test.ts —
// the older signature this file was written against is gone.
function buildApp() {
  const app = createComposedApp("memory", silentLogger);
  return app.getExpressApp();
}

async function loginAs(
  agent: ReturnType<typeof request.agent>,
  email: string,
  password = "password123"
) {
  await agent.post("/login").type("form").send({ email, password });
}

describe("GET /events — event filter route", () => {
  it("redirects unauthenticated users to /login", async () => {
    const agent = request.agent(buildApp());
    const res = await agent.get("/events");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/login");
  });

  it("returns 200 for an authenticated user with no filters", async () => {
    const agent = request.agent(buildApp());
    await loginAs(agent, "user@app.test");

    const res = await agent.get("/events");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Browse Events");
  });

  it("returns 200 for a valid timeframe filter", async () => {
    const agent = request.agent(buildApp());
    await loginAs(agent, "user@app.test");

    const res = await agent.get("/events?timeframe=week");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Browse Events");
  });

  it("returns 200 for a valid category filter", async () => {
    const agent = request.agent(buildApp());
    await loginAs(agent, "user@app.test");

    const res = await agent.get("/events?category=general");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Browse Events");
  });

  it("returns 400 and the error message for an invalid timeframe filter", async () => {
    const agent = request.agent(buildApp());
    await loginAs(agent, "user@app.test");

    const res = await agent.get("/events?timeframe=banana");

    expect(res.status).toBe(400);
    expect(res.text).toContain("Invalid timeframe filter");
  });

  it("returns the partial event list for HTMX filter requests", async () => {
    const agent = request.agent(buildApp());
    await loginAs(agent, "user@app.test");

    const res = await agent
      .get("/events?timeframe=week")
      .set("HX-Request", "true");

    expect(res.status).toBe(200);
    expect(res.text).toContain('id="event-list"');
    expect(res.text).not.toContain("Browse Events");
  });
});