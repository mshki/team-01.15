
import { EventError } from "../lib/errors";
import { Result } from "../lib/result";
import { CreateEventData, IEvent, IRSVP, RSVPStatus, } from "../types/EventTypes";

export interface IEventRepository {
    getAllEvents(): Promise<Result<IEvent[], EventError>>;
    getEventById(id: number): Promise<Result<IEvent, EventError>>;
    createEvent(event: CreateEventData): Promise<Result<IEvent, EventError>>;
    updateEvent(id: number, event: Partial<IEvent>): Promise<Result<IEvent, EventError>>;
    deleteEvent(id: number): Promise<Result<void, EventError>>;
    findUserRsvp(id: number, userId: string): Promise<Result<IRSVP | null, EventError>>;
    saveRsvp(id: number, userId: string, status: RSVPStatus): Promise<Result<void, EventError>>;
    /**
     * Atomically cancels the RSVP for `userId` on `eventId` and, if that
     * cancellation frees a seat (i.e. the user was GOING and the event has a
     * finite capacity), promotes the earliest WAITLISTED RSVP to GOING.
     *
     * Both writes must succeed together or fail together: implementations
     * back this with a database transaction (Prisma) or an atomic in-memory
     * mutation (InMemory). This guarantees we never end up in a state where
     * the cancellation persisted but the promotion didn't, which would
     * silently shrink the event's effective attendance.
     *
     * Returns the updated event (with refreshed attendees) on success.
     * Returns EventNotFoundError if the event or the user's RSVP is missing.
     */
    cancelRsvpWithPromotion(
        eventId: number,
        userId: string
    ): Promise<Result<IEvent, EventError>>;
}
