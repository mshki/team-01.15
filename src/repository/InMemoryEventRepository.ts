import { EventNotFoundError, DatabaseError } from "../lib/errors";
import { Err, Ok, type Result } from "../lib/result";
import type { EventError } from "../lib/errors";
import type { IEventRepository } from "./EventRepository";
import { CreateEventData, Event, type IEvent } from "../types/EventTypes";

class InMemoryEventRepository implements IEventRepository {
    private events = new Map<number, IEvent>();
    private nextId = 1;

    async getAllEvents(): Promise<Result<IEvent[], EventError>> {
        return Ok(Array.from(this.events.values()));
    }

    async getEventById(id: number): Promise<Result<IEvent, EventError>> {
        const event = this.events.get(id);
        if (!event) {
            return Err(EventNotFoundError(`Event with id ${id} not found`));
        }
        return Ok(event);
    }

    async createEvent(event: CreateEventData): Promise<Result<IEvent, EventError>> {
        const newEvent = new Event(this.nextId++, event);
        this.events.set(newEvent.id, newEvent);
        return Ok(newEvent);
    }

    async updateEvent(id: number, updates: Partial<IEvent>): Promise<Result<IEvent, EventError>> {
        const event = this.events.get(id);
        if (!event) {
            return Err(EventNotFoundError(`Event with id ${id} not found`));
        }
        const updated = { ...event, ...updates, id: event.id, organizerId: event.organizerId, createdAt: event.createdAt};
        this.events.set(id, updated);
        return Ok(updated);
    }

    async deleteEvent(id: number): Promise<Result<void, EventError>> {
        if (!this.events.has(id)) {
            return Err(EventNotFoundError(`Event with id ${id} not found`));
        }
        this.events.delete(id);
        return Ok(undefined);
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
}

export function createInMemoryEventRepository(): IEventRepository {
  return new InMemoryEventRepository();
}
