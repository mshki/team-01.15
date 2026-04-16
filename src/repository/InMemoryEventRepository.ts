import { EventNotFoundError, DatabaseError } from "../lib/errors";
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

  async searchEvents(query: string): Promise<Result<IEvent[], EventError>> {
    try {
        const all = Array.from(events.values());

        if (query.trim() === '') {
            const now = new Date();
            const results = all.filter(e =>
                e.eventDesc.status === 'PUBLISHED' &&
                e.eventDesc.datetime > now
            );
            return Ok(results);
        }

        const q = query.trim().toLowerCase();
        const now = new Date();
        const results = all.filter(e => {
            if (e.eventDesc.status !== 'PUBLISHED') return false;
            if (e.eventDesc.datetime <= now) return false;

            return (
                e.eventDesc.title.toLowerCase().includes(q) ||
                e.eventDesc.desc.toLowerCase().includes(q) ||
                e.eventDesc.location.toLowerCase().includes(q) ||
                e.eventDesc.category.toLowerCase().includes(q)
            );
        });

        return Ok(results);
    } catch (e) {
        return Err(DatabaseError(String(e)));
    }
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
