import { EventNotFoundError } from "../lib/errors";
import { Err, Ok, type Result } from "../lib/result";
import type { EventError } from "../lib/errors";
import type { IEventRepository } from "./EventRepository";
import type { IEvent } from "../types/EventTypes";

const events = new Map<string, IEvent>();

events.set("1", {
  id: 1,
  title: "Hack Night",
  createdAt: new Date(),
  attendees: [],
  eventDesc: {
    id: 1,
    eventId: 1,
    title: "Hack Night",
    desc: "Work on projects together",
    location: "CS Building",
    category: "Tech",
    datetime: new Date("2026-04-20T18:00:00"),
    organizerId: "user1",
    capacity: 25,
    status: "DRAFT",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
});

events.set("2", {
  id: 2,
  title: "Music Jam",
  createdAt: new Date(),
  attendees: [],
  eventDesc: {
    id: 2,
    eventId: 2,
    title: "Music Jam",
    desc: "Live student performance",
    location: "Student Union",
    category: "Music",
    datetime: new Date("2026-04-25T19:30:00"),
    organizerId: "user2",
    capacity: 100,
    status: "PUBLISHED",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
});

class InMemoryEventRepository implements IEventRepository {
  async getAllEvents(): Promise<Result<IEvent[], EventError>> {
    return Ok(Array.from(events.values()));
  }

  async getEventById(id: string): Promise<Result<IEvent, EventError>> {
    const event = events.get(id);

    if (!event) {
      return Err(EventNotFoundError(`Event ${id} not found`));
    }

    return Ok(event);
  }

  async createEvent(event: IEvent): Promise<Result<IEvent, EventError>> {
    const key = String(event.id);
    events.set(key, event);
    return Ok(event);
  }

  async updateEvent(
    id: string,
    event: Partial<IEvent>,
  ): Promise<Result<IEvent, EventError>> {
    const existing = events.get(id);

    if (!existing) {
      return Err(EventNotFoundError(`Event ${id} not found`));
    }

    const updated: IEvent = {
      ...existing,
      ...event,
      attendees: event.attendees ?? existing.attendees,
      eventDesc: {
        ...existing.eventDesc,
        ...(event.eventDesc ?? {}),
        updatedAt: new Date(),
      },
    };

  events.set(id, updated);
  return Ok(updated);
}

  async deleteEvent(id: string): Promise<Result<void, EventError>> {
    const existing = events.get(id);

    if (!existing) {
      return Err(EventNotFoundError(`Event ${id} not found`));
    }

    events.delete(id);
    return Ok(undefined);
  }
}

export function createInMemoryEventRepository(): IEventRepository {
  return new InMemoryEventRepository();
}