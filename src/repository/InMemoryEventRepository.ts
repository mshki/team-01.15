import { EventNotFoundError, DatabaseError, ValidationError } from "../lib/errors";
import { Err, Ok, type Result } from "../lib/result";
import type { EventError } from "../lib/errors";
import type { IEventRepository } from "./EventRepository";
import { CreateEventData, Event, IRSVP, IEvent, RSVPStatus } from "../types/EventTypes";

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

    async findUserRsvp(id: number, userId: string): Promise<Result<IRSVP | null, EventError>> {
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

    async saveRsvp(id: number, userId: string, status: RSVPStatus): Promise<Result<void, EventError>> {
        const event = this.events.get(id);
        if (!event) {
            return Err(EventNotFoundError(`Event with id ${id} not found`));
        }

        const existingRsvpIndex = event.attendees.findIndex(
            (attendee) => attendee.userId === userId
        );

        if (existingRsvpIndex !== -1) {
            event.attendees[existingRsvpIndex] = {
                ...event.attendees[existingRsvpIndex],
                rsvpStatus: status,
            };
        } else {
            const newRsvp = {
                id: `rsvp_${id}_${userId}_${Date.now().toString(36)}`,
                eventId: id,
                userId,
                rsvpStatus: status,
                createdAt: new Date(),
            };

            event.attendees.push(newRsvp);
        }

        return Ok(undefined);
    }

    /**
     * Atomically cancels the user's RSVP and, if a seat opened up, promotes
     * the earliest WAITLISTED RSVP to GOING. The in-memory implementation is
     * naturally atomic: both attendee mutations happen on the same event
     * object before the method returns, so no partial state is observable
     * to other callers between the two writes.
     */
    async cancelRsvpWithPromotion(
        eventId: number,
        userId: string
    ): Promise<Result<IEvent, EventError>> {
        const event = this.events.get(eventId);
        if (!event) {
            return Err(EventNotFoundError(`Event with id ${eventId} not found`));
        }

        const rsvpIdx = event.attendees.findIndex(
            (r) => r.eventId === eventId && r.userId === userId
        );
        if (rsvpIdx === -1) {
            return Err(
                ValidationError(`No RSVP found for user ${userId} on event ${eventId}`)
            );
        }

        const existing = event.attendees[rsvpIdx];
        if (existing.rsvpStatus === "CANCELLED") {
            return Err(
                ValidationError(
                    `RSVP for user ${userId} on event ${eventId} is already cancelled`
                )
            );
        }

        const wasGoing = existing.rsvpStatus === "GOING";

        // Step 1: cancel the user's RSVP
        event.attendees[rsvpIdx] = {
            ...existing,
            rsvpStatus: "CANCELLED",
        };

        // Step 2: if cancellation freed a seat, promote the earliest waitlisted RSVP.
        // Only relevant when the user was GOING (cancelling a WAITLISTED RSVP doesn't
        // free a seat) and the event has a finite capacity.
        if (wasGoing && event.capacity != null) {
            const goingCount = event.attendees.filter(
                (r) => r.rsvpStatus === "GOING"
            ).length;
            if (goingCount < event.capacity) {
                const earliestWaitlisted = event.attendees
                    .filter((r) => r.rsvpStatus === "WAITLISTED")
                    .sort(
                        (a, b) =>
                            new Date(a.createdAt).getTime() -
                            new Date(b.createdAt).getTime()
                    )[0];
                if (earliestWaitlisted) {
                    const wIdx = event.attendees.findIndex(
                        (r) => r.id === earliestWaitlisted.id
                    );
                    event.attendees[wIdx] = {
                        ...earliestWaitlisted,
                        rsvpStatus: "GOING",
                    };
                }
            }
        }

        event.updatedAt = new Date();
        return Ok(event);
    }

    /**
     * In-memory mirror of the Prisma-backed search. Filters the event map
     * down to PUBLISHED events whose endDatetime is in the future, then
     * (if `query` is non-empty) keeps only those whose title, description,
     * location, or category contains `query` as a case-insensitive
     * substring.
     *
     * `query` is expected to already be trimmed + lowercased by the
     * service layer, so we lowercase each haystack field and use plain
     * `includes`. This stays symmetric with how the Prisma side relies on
     * SQLite's case-insensitive LIKE for ASCII characters.
     */
    async searchEvents(query: string): Promise<Result<IEvent[], EventError>> {
        const now = new Date();
        const publishedUpcoming = Array.from(this.events.values()).filter(
            (event) =>
                event.status === "PUBLISHED" &&
                event.endDatetime.getTime() >= now.getTime()
        );

        if (query === "") {
            return Ok(publishedUpcoming);
        }

        const matches = publishedUpcoming.filter((event) => {
            const haystacks = [
                event.title,
                event.description,
                event.location,
                event.category ?? "",
            ];
            return haystacks.some((field) =>
                field.toLowerCase().includes(query)
            );
        });

        return Ok(matches);
    }

    async filterPublishedEvents(
        timeframe: string,
        category: string | null
    ): Promise<Result<IEvent[], EventError>> {
        const now = new Date();

        let filteredEvents = Array.from(this.events.values()).filter(
            (event) =>
                event.status === "PUBLISHED" &&
                event.endDatetime.getTime() >= now.getTime()
        );

        if (category && category.trim() !== "") {
            const normalizedCategory = category.trim().toLowerCase();

            filteredEvents = filteredEvents.filter(
                (event) => (event.category ?? "").trim().toLowerCase() === normalizedCategory
            );
        }

        if (timeframe === "all") {
            return Ok(filteredEvents);
        }

        if (timeframe === "week") {
            const endOfWeek = new Date(now);
            endOfWeek.setDate(now.getDate() + 7);

            return Ok(
                filteredEvents.filter(
                    (event) => event.startDatetime.getTime() <= endOfWeek.getTime()
                )
            );
        }

        if (timeframe === "weekend") {
            const day = now.getDay();
            const daysUntilSaturday = day === 6 ? 0 : (6 - day + 7) % 7;

            const saturday = new Date(now);
            saturday.setDate(now.getDate() + daysUntilSaturday);
            saturday.setHours(0, 0, 0, 0);

            const sundayEnd = new Date(saturday);
            sundayEnd.setDate(saturday.getDate() + 1);
            sundayEnd.setHours(23, 59, 59, 999);

            return Ok(
                filteredEvents.filter((event) => {
                    const start = event.startDatetime.getTime();
                    return start >= saturday.getTime() && start <= sundayEnd.getTime();
                })
            );
        }

        return Err(ValidationError("Invalid timeframe filter"));
    }
}

export function createInMemoryEventRepository(): IEventRepository {
  return new InMemoryEventRepository();
}
