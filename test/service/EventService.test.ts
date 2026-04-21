import { createEventService } from "../../src/service/EventService";
import { createInMemoryEventRepository } from "../../src/repository/InMemoryEventRepository";
import type { ILoggingService } from "../../src/service/LoggingService";
import type { CreateEventData, IEvent } from "../../src/types/EventTypes";

/**
 * Tests for Feature 9 — Waitlist Promotion.
 *
 * These tests exercise the waitlist behavior through the public EventService
 * surface (toggleRsvp + getQueuePosition) against the in-memory repository,
 * because the repository is the real collaborator the service ships with and
 * the waitlist logic is intentionally centralized in the service layer.
 *
 * Sprint 2 coverage:
 *   1. Promotion happens correctly when a spot opens up (FIFO).
 *   2. No promotion occurs when the waitlist is empty.
 *   3. Queue positions are calculated accurately (and update after a promotion).
 */

// The service logs throughout; swallow it in tests so the output stays quiet.
// We don't assert on log calls — these tests are about behavior, not telemetry.
const silentLogger: ILoggingService = {
    info: () => {},
    warn: () => {},
    error: () => {},
};

function buildService() {
    const repo = createInMemoryEventRepository();
    const service = createEventService(repo, silentLogger);
    return { repo, service };
}

function makeEventData(overrides: Partial<CreateEventData> = {}): CreateEventData {
    // Put the event a day in the future so canRsvp's "past event" guard never fires.
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
        title: "Test event",
        description: "A test event.",
        location: "Somewhere",
        status: "PUBLISHED",
        organizerId: "organizer-1",
        startDatetime: start,
        endDatetime: end,
        capacity: 2,
        attendees: [],
        ...overrides,
    };
}

async function createEventForTest(
    service: ReturnType<typeof buildService>["service"],
    overrides: Partial<CreateEventData> = {}
): Promise<IEvent> {
    const result = await service.createEvent(makeEventData(overrides));
    if (!result.ok) {
        throw new Error(`Test setup failed to create event: ${result.value.message}`);
    }
    return result.value;
}

describe("EventService — waitlist promotion on cancel", () => {
    it("promotes the next waitlisted user when a GOING attendee cancels", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, { capacity: 2 });

        // Fill the event, then put a third user on the waitlist.
        await service.toggleRsvp(event.id, "user-1", "user");
        await service.toggleRsvp(event.id, "user-2", "user");
        const joined3 = await service.toggleRsvp(event.id, "user-3", "user");

        expect(joined3.ok).toBe(true);
        if (joined3.ok) {
            const u3 = joined3.value.attendees.find((a) => a.userId === "user-3");
            expect(u3?.rsvpStatus).toBe("WAITLISTED");
        }

        // user-1 cancels — in the same service call, user-3 should be promoted.
        const afterCancel = await service.toggleRsvp(event.id, "user-1", "user");
        expect(afterCancel.ok).toBe(true);
        if (!afterCancel.ok) return;

        const updated = afterCancel.value;
        const u1 = updated.attendees.find((a) => a.userId === "user-1");
        const u2 = updated.attendees.find((a) => a.userId === "user-2");
        const u3 = updated.attendees.find((a) => a.userId === "user-3");

        expect(u1?.rsvpStatus).toBe("CANCELLED");
        expect(u2?.rsvpStatus).toBe("GOING");
        expect(u3?.rsvpStatus).toBe("GOING");

        // The event should be back at capacity via promotion, with nobody left waiting.
        const goingCount = updated.attendees.filter((a) => a.rsvpStatus === "GOING").length;
        const waitlistCount = updated.attendees.filter(
            (a) => a.rsvpStatus === "WAITLISTED"
        ).length;
        expect(goingCount).toBe(2);
        expect(waitlistCount).toBe(0);
    });

    it("promotes the earliest-joined waitlister (FIFO), not an arbitrary one", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, { capacity: 1 });

        await service.toggleRsvp(event.id, "user-1", "user"); // GOING
        await service.toggleRsvp(event.id, "user-a", "user"); // WAITLISTED #1
        await service.toggleRsvp(event.id, "user-b", "user"); // WAITLISTED #2
        await service.toggleRsvp(event.id, "user-c", "user"); // WAITLISTED #3

        const afterCancel = await service.toggleRsvp(event.id, "user-1", "user");
        expect(afterCancel.ok).toBe(true);
        if (!afterCancel.ok) return;

        const ua = afterCancel.value.attendees.find((a) => a.userId === "user-a");
        const ub = afterCancel.value.attendees.find((a) => a.userId === "user-b");
        const uc = afterCancel.value.attendees.find((a) => a.userId === "user-c");

        // Only user-a (the earliest join) gets promoted; b and c stay in line.
        expect(ua?.rsvpStatus).toBe("GOING");
        expect(ub?.rsvpStatus).toBe("WAITLISTED");
        expect(uc?.rsvpStatus).toBe("WAITLISTED");
    });
});

describe("EventService — no promotion when waitlist is empty", () => {
    it("leaves remaining attendees alone when a GOING user cancels with no waitlist", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, { capacity: 2 });

        await service.toggleRsvp(event.id, "user-1", "user");
        await service.toggleRsvp(event.id, "user-2", "user");

        const afterCancel = await service.toggleRsvp(event.id, "user-1", "user");
        expect(afterCancel.ok).toBe(true);
        if (!afterCancel.ok) return;

        const updated = afterCancel.value;
        const u1 = updated.attendees.find((a) => a.userId === "user-1");
        const u2 = updated.attendees.find((a) => a.userId === "user-2");

        expect(u1?.rsvpStatus).toBe("CANCELLED");
        expect(u2?.rsvpStatus).toBe("GOING");

        const goingCount = updated.attendees.filter((a) => a.rsvpStatus === "GOING").length;
        const waitlistCount = updated.attendees.filter(
            (a) => a.rsvpStatus === "WAITLISTED"
        ).length;
        expect(goingCount).toBe(1);
        expect(waitlistCount).toBe(0);
    });

    it("does not promote on an unlimited-capacity event (there is no waitlist at all)", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, { capacity: null });

        await service.toggleRsvp(event.id, "user-1", "user");
        await service.toggleRsvp(event.id, "user-2", "user");

        const afterCancel = await service.toggleRsvp(event.id, "user-1", "user");
        expect(afterCancel.ok).toBe(true);
        if (!afterCancel.ok) return;

        // Nobody should have been spuriously moved — there was never a waitlist.
        const waitlistCount = afterCancel.value.attendees.filter(
            (a) => a.rsvpStatus === "WAITLISTED"
        ).length;
        expect(waitlistCount).toBe(0);

        const u2 = afterCancel.value.attendees.find((a) => a.userId === "user-2");
        expect(u2?.rsvpStatus).toBe("GOING");
    });
});

describe("EventService — queue position calculation", () => {
    it("returns 1-based positions in join order for waitlisted users", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, { capacity: 1 });

        await service.toggleRsvp(event.id, "user-going", "user"); // takes the only spot
        await service.toggleRsvp(event.id, "user-a", "user");     // waitlist #1
        await service.toggleRsvp(event.id, "user-b", "user");     // waitlist #2
        await service.toggleRsvp(event.id, "user-c", "user");     // waitlist #3

        const qpA = await service.getQueuePosition(event.id, "user-a");
        const qpB = await service.getQueuePosition(event.id, "user-b");
        const qpC = await service.getQueuePosition(event.id, "user-c");

        expect(qpA.ok).toBe(true);
        expect(qpB.ok).toBe(true);
        expect(qpC.ok).toBe(true);
        if (qpA.ok) expect(qpA.value).toBe(1);
        if (qpB.ok) expect(qpB.value).toBe(2);
        if (qpC.ok) expect(qpC.value).toBe(3);
    });

    it("returns null for a user who is GOING (not waitlisted)", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, { capacity: 5 });

        await service.toggleRsvp(event.id, "user-1", "user");

        const qp = await service.getQueuePosition(event.id, "user-1");
        expect(qp.ok).toBe(true);
        if (qp.ok) expect(qp.value).toBeNull();
    });

    it("returns null for a user who has never RSVP'd to the event", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, { capacity: 1 });

        await service.toggleRsvp(event.id, "user-1", "user");

        const qp = await service.getQueuePosition(event.id, "stranger");
        expect(qp.ok).toBe(true);
        if (qp.ok) expect(qp.value).toBeNull();
    });

    it("recalculates positions after a promotion (the old #2 becomes the new #1)", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, { capacity: 1 });

        await service.toggleRsvp(event.id, "user-1", "user"); // GOING
        await service.toggleRsvp(event.id, "user-a", "user"); // WAITLISTED #1
        await service.toggleRsvp(event.id, "user-b", "user"); // WAITLISTED #2

        // Sanity check: user-b starts at position 2.
        const before = await service.getQueuePosition(event.id, "user-b");
        expect(before.ok).toBe(true);
        if (before.ok) expect(before.value).toBe(2);

        // user-1 cancels -> user-a is promoted -> user-b is now next in line.
        await service.toggleRsvp(event.id, "user-1", "user");

        const after = await service.getQueuePosition(event.id, "user-b");
        expect(after.ok).toBe(true);
        if (after.ok) expect(after.value).toBe(1);
    });

    it("rejects invalid event IDs and surfaces EventNotFoundError for missing events", async () => {
        const { service } = buildService();

        const badId = await service.getQueuePosition(0, "user-1");
        expect(badId.ok).toBe(false);
        if (!badId.ok) expect(badId.value.name).toBe("ValidationError");

        const missingUser = await service.getQueuePosition(1, "");
        expect(missingUser.ok).toBe(false);
        if (!missingUser.ok) expect(missingUser.value.name).toBe("ValidationError");

        const missingEvent = await service.getQueuePosition(9999, "user-1");
        expect(missingEvent.ok).toBe(false);
        if (!missingEvent.ok) expect(missingEvent.value.name).toBe("EventNotFoundError");
    });
});
describe("EventService — publish transitions", () => {
    it("allows organizer to publish a draft event", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, {
            status: "DRAFT",
            organizerId: "user-staff",
        });

        const result = await service.publishEvent(event.id, "user-staff");

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.status).toBe("PUBLISHED");
        }
    });

    it("rejects publish when user is not the organizer", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, {
            status: "DRAFT",
            organizerId: "user-staff",
        });

        const result = await service.publishEvent(event.id, "user-admin");

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.value.name).toBe("UnauthorizedEventActionError");
            expect(result.value.message).toBe("Only the organizer can publish this event");
        }
    });

    it("rejects publish when event is not in draft state", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, {
            status: "PUBLISHED",
            organizerId: "user-staff",
        });

        const result = await service.publishEvent(event.id, "user-staff");

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.value.name).toBe("InvalidEventTransitionError");
            expect(result.value.message).toBe("Only draft events can be published");
        }
    });
});

describe("EventService — cancel transitions", () => {
    it("allows organizer to cancel a published event", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, {
            status: "PUBLISHED",
            organizerId: "user-staff",
        });

        const result = await service.cancelEvent(event.id, "user-staff", false);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.status).toBe("CANCELLED");
        }
    });

    it("allows admin to cancel another user's published event", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, {
            status: "PUBLISHED",
            organizerId: "user-staff",
        });

        const result = await service.cancelEvent(event.id, "user-admin", true);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.value.status).toBe("CANCELLED");
        }
    });

    it("rejects cancel when user is not organizer or admin", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, {
            status: "PUBLISHED",
            organizerId: "user-staff",
        });

        const result = await service.cancelEvent(event.id, "user-reader", false);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.value.name).toBe("UnauthorizedEventActionError");
            expect(result.value.message).toBe("Only the organizer or an admin can cancel this event");
        }
    });
});
describe("EventService — invalid lifecycle transitions", () => {
    it("rejects cancel when event is not published", async () => {
        const { service } = buildService();
        const event = await createEventForTest(service, {
            status: "DRAFT",
            organizerId: "user-staff",
        });

        const result = await service.cancelEvent(event.id, "user-staff", false);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.value.name).toBe("InvalidEventTransitionError");
            expect(result.value.message).toBe("Only published events can be cancelled");
        }
    });
});
describe("EventService — published event filters", () => {
    it("returns all published upcoming events when no filters are provided", async () => {
        const { service } = buildService();

        await createEventForTest(service, {
            title: "Published A",
            status: "PUBLISHED",
        });

        await createEventForTest(service, {
            title: "Published B",
            status: "PUBLISHED",
        });

        await createEventForTest(service, {
            title: "Draft Event",
            status: "DRAFT",
        });

        const result = await service.filterPublishedEvents();

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const titles = result.value.map((e) => e.title);
        expect(titles).toContain("Published A");
        expect(titles).toContain("Published B");
        expect(titles).not.toContain("Draft Event");
    });

    it("filters published events by category", async () => {
        const { service } = buildService();

        await createEventForTest(service, {
            title: "Music Night",
            status: "PUBLISHED",
            category: "music",
        });

        await createEventForTest(service, {
            title: "Sports Meetup",
            status: "PUBLISHED",
            category: "sports",
        });

        const result = await service.filterPublishedEvents("all", "music");

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.title).toBe("Music Night");
    });
});
