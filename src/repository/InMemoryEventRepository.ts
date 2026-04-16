import { EventNotFoundError } from "../lib/errors";
import { Err, Ok, type Result } from "../lib/result";
import type { EventError } from "../lib/errors";
import type { IEventRepository } from "./EventRepository";
import type { IEvent } from "../types/EventTypes";

class InMemoryEventRepository implements IEventRepository {
    private events = new Map<string, IEvent>();

    async getAllEvents(): Promise<Result<IEvent[], EventError>> {
        return Ok(Array.from(this.events.values()));
    }

    async getEventById(id: string): Promise<Result<IEvent, EventError>> {
        const event = this.events.get(id);
        if (!event) {
            return Err(EventNotFoundError(`Event with id ${id} not found`));
        }
        return Ok(event);
    }

    async createEvent(event: IEvent): Promise<Result<IEvent, EventError>> {
        this.events.set(String(event.id), event);
        return Ok(event);
    }

    async updateEvent(id: string, updates: Partial<IEvent>): Promise<Result<IEvent, EventError>> {
        const event = this.events.get(id);
        if (!event) {
            return Err(EventNotFoundError(`Event with id ${id} not found`));
        }
        const updated = { ...event, ...updates, updatedAt: new Date() };
        this.events.set(id, updated);
        return Ok(updated);
    }

    async deleteEvent(id: string): Promise<Result<void, EventError>> {
        if (!this.events.has(id)) {
            return Err(EventNotFoundError(`Event with id ${id} not found`));
        }
        this.events.delete(id);
        return Ok(undefined);
    }
}

export function createInMemoryEventRepository(): IEventRepository {
  return new InMemoryEventRepository();
}