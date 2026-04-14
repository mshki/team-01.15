import { EventNotFoundError } from "../lib/errors";
import { Err, Ok, type Result } from "../lib/result";
import type { EventError } from "../lib/errors";
import type { IEventRepository } from "./EventRepository";
import type { IEvent } from "../types/EventTypes";

const events = new Map<string, IEvent>();



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