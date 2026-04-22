import { EventNotFoundError, DatabaseError } from "../lib/errors";
import { Err, Ok, type Result } from "../lib/result";
import type { EventError, RSVPError } from "../lib/errors";
import type { IEventRepository } from "./EventRepository";
import { CreateEventData, Event, IRSVP, type IEvent } from "../types/EventTypes";

class InMemoryEventRepository implements IEventRepository {
    private events = new Map<number, IEvent>(
        [new Event(1, {
            title: "Team Kickoff 2026",
            description: "Join us for the annual team kickoff to align on goals and celebrate the year ahead.",
            location: "Main Conference Room",
            category: "general",
            capacity: 50,
            status: "PUBLISHED",
            organizerId: "user-admin",
            startDatetime: new Date("2026-05-01T09:00:00"),
            endDatetime: new Date("2026-05-01T11:00:00"),
            attendees: [],
        })].map(e => [e.id, e])
    );
    private nextId = 2;

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

    async findUserRsvp(id: number, userId: string): Promise<Result<IRSVP | null, EventError | RSVPError>> {
        const event = this.events.get(id);
        if (!event) {
            return Err(EventNotFoundError(`Event with id ${id} not found`));
        }
      
        const rsvp = event.attendees.find(
            (attendee) => attendee.eventId === id && attendee.userId === userId
        );
      
        if (!rsvp) {
            return Ok(null);
        }
      
        return Ok({
          ...rsvp,
            createdAt: new Date(rsvp.createdAt),
        });
    }
}

export function createInMemoryEventRepository(): IEventRepository {
  return new InMemoryEventRepository();
}
