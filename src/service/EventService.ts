import { permission } from "node:process";
import { AuthError, AuthorizationRequired } from "../auth/errors";
import {
    DatabaseError,
    EventError,
    EventNotFoundError,
    InvalidEventFilterError,
    InvalidEventTransitionError,
    InvalidFieldError,
    InvalidRSVPError,
    InvalidSearchQueryError,
    RSVPError,
    UnauthorizedEventActionError,
    UnauthorizedRSVPError,
    UnknownError,
    ValidationError
} from "../lib/errors";
import { IAuthenticatedUserSession } from "../session/AppSession";
import { Err, Ok, Result } from "../lib/result";
import { IEventRepository } from "../repository/EventRepository";
import { CreateEventData, EventStatus, IEvent, IRSVP, RSVPStatus } from "../types/EventTypes";
import { ILoggingService } from "./LoggingService";
import { UserRole } from "../auth/User";



export interface IEventService {
    createEvent(session: IAuthenticatedUserSession, eventData: CreateEventData): Promise<Result<IEvent, EventError>>;
    getEventDetails(eventId: number): Promise<Result<IEvent, EventError>>;
    getEventEditForm(eventId: number, userId: String, userRole: string): Promise<Result<IEvent, EventError>>;
    updateEvent(eventId: number, 
        userId: string,
        userRole: string,
        title: string,
        description: string,
        location: string,
        category: string,
        status: EventStatus,
        startDatetime: Date,
        endDatetime: Date,
        capacity: number): Promise<Result<IEvent, EventError>>;
    toggleRsvp(eventId: number, userId: string, userRole: UserRole): Promise<Result<IEvent, EventError | RSVPError>>;
    publishEvent(eventId: number, userId: string): Promise<Result<IEvent, EventError>>;
    cancelEvent(eventId: number, userId: string, isAdmin: boolean): Promise<Result<IEvent, EventError>>;
    filterPublishedEvents(timeframe?: string, category?: string | null): Promise<Result<IEvent[], EventError>>;
    /**
     * Searches published upcoming events whose title, description, location, or
     * category contains `query` as a case-insensitive substring.
     *
     * An empty or whitespace-only query is treated as "no filter" and returns
     * every published event whose endDatetime is in the future. This mirrors
     * Sprint 1's spec: empty query returns all published upcoming events.
     */
    searchEvents(query: string): Promise<Result<IEvent[], EventError>>;
    /**
     * Returns the 1-based position of the given user in the waitlist for the event,
     * or null if the user is not currently waitlisted. Position is ordered by
     * createdAt (earliest join is #1).
     */
    getQueuePosition(eventId: number, userId: string): Promise<Result<number | null, EventError>>;
    getDraftEventsForUser(userId: string, userRole: string): Promise<Result<IEvent[], EventError>>;
    deleteDraftEvent(eventId: number, userId: string, userRole: string): Promise<Result<void, EventError>>;
}

class EventService implements IEventService {
    constructor(private readonly eventRepository: IEventRepository, private readonly logger: ILoggingService) {}

    private countGoing(attendees: IRSVP[]): number {
        return attendees.filter((r) => r.rsvpStatus === "GOING").length;
      }
      
      private nextJoinStatus(event: IEvent): RSVPStatus {
        if (event.capacity === null) {
          return "GOING";
        }
      
        const goingCount = this.countGoing(event.attendees);
        return goingCount < event.capacity ? "GOING" : "WAITLISTED";
      }
      
      /**
       * Returns the waitlisted RSVPs for an event, ordered by join time (earliest first).
       * This is the canonical ordering used for both queue position and promotion,
       * so both operations agree on who is "next" in line.
       */
      private orderedWaitlist(event: IEvent): IRSVP[] {
        return event.attendees
          .filter((r) => r.rsvpStatus === "WAITLISTED")
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }

      /**
       * Returns the 1-based position of `userId` in the event's waitlist,
       * or null if that user is not currently waitlisted.
       */
      private calculateQueuePosition(event: IEvent, userId: string): number | null {
        const waitlist = this.orderedWaitlist(event);
        const idx = waitlist.findIndex((r) => r.userId === userId);
        return idx === -1 ? null : idx + 1;
      }

    async createEvent(session: IAuthenticatedUserSession, eventData: CreateEventData): Promise<Result<IEvent, EventError>> {
        // Only staff or higher can create events
        if (session.role == "user") {
            this.logger.warn(`User ${session.userId} with role "user" attempted to create event.`);
            return Err(UnauthorizedEventActionError("Only staff or higher can create events."));
        }
        
        // 1. Validate input data
        const title = String(eventData.title ?? "").trim();
        const description = String(eventData.description ?? "").trim();
        const location = String(eventData.location ?? "").trim();
        const { organizerId, startDatetime, endDatetime, capacity, status, attendees, category } = eventData;

        if (!title) {
            return Err(InvalidFieldError("Title is required."));
        }
        if (title.length < 3) {
            return Err(InvalidFieldError("Title must be at least 3 characters."));
        }
        if (!description) {
            return Err(InvalidFieldError("Description is required."));
        }
        if (!location) {
            return Err(InvalidFieldError("Location is required."));
        }
        if (!organizerId) {
            return Err(InvalidFieldError("Organizer is required."));
        }
        if (!startDatetime || !endDatetime) {
            return Err(InvalidFieldError("Start and end datetime are required."));
        }
        if (endDatetime <= startDatetime) {
            return Err(InvalidFieldError("End datetime must be after start datetime."));
        }
        if (capacity != null && capacity < 1) {
            return Err(InvalidFieldError("Capacity must be at least 1."));
        }

        // 2. Call repository to create event
        const result = await this.eventRepository.createEvent({ title: title, description: description, location: location, category: category, organizerId: organizerId, startDatetime: startDatetime, endDatetime: endDatetime, capacity: capacity, status: status, attendees: attendees,
});
        this.logger.info(`Attempted to create event with title "${title}". Result: ${result.ok ? "Success" : "Error"}`);

        // 3. Handle repository result and return appropriate response
        return result;
    }

    async getEventDetails(eventId: number): Promise<Result<IEvent, EventError>> {
        // 1. Validate event ID
        if (!eventId || eventId <= 0) {
            return Err(ValidationError("Invalid event ID."));
        }

        // 2. Call repository to get event details
        this.logger.info(`Fetching details for event ID ${eventId}`);

        const result = await this.eventRepository.getEventById(eventId);
        this.logger.info(`Fetch event details result for ID ${eventId}: ${result.ok ? "Success" : "Error"}`);

        if (!result.ok) {
            const error = result.value as EventError;
            if (error.name === "EventNotFoundError") {
                return Err(EventNotFoundError(`Event with ID ${eventId} not found.`));
            }
            return Err(error);
        }

        // 3. Handle repository result and return appropriate response
        return Ok(result.value);
    }

    async getEventEditForm(eventId: number, userId: string, userRole: string): Promise<Result<IEvent, EventError>> {
        const eventResponse = await this.eventRepository.getEventById(eventId);

        if (!eventResponse.ok) {
            return Err(EventNotFoundError(`Event ${eventId} not found.`));
        }

        const event = eventResponse.value;
        const isAdmin = userRole=== "admin";
        const isOwner = event.organizerId === userId;
    
        if (!isAdmin && !isOwner) {
            return Err(UnauthorizedEventActionError("Need permission to edit this event."));
        }
    
        const now = new Date();
        if (event.status === "CANCELLED" || event.status === "CONCLUDED") {
            return Err(ValidationError("Cancelled or concluded events cannot be edited."));
        }
    
        if (event.endDatetime.getTime() < now.getTime()) {
            return Err(ValidationError("Past events cannot be edited."));
        }

        return Ok(event);
    }

    async updateEvent(eventId: number, userId: string, userRole: string, title: string, description: string, location: string, category: string, status: EventStatus, startDatetime: Date, endDatetime: Date, capacity: number): Promise<Result<IEvent, EventError>> {
        const eventResult = await this.getEventEditForm(eventId, userId, userRole);
        if (!eventResult.ok) {
          return eventResult;
        }

        if (!title) {
            return Err(ValidationError("Title is required."));
        }
        if (title.length < 3) {
            return Err(ValidationError("Title must be at least 3 characters."));
        }
        if (!description) {
            return Err(ValidationError("Description is required."));
        }
        if (!location) {
            return Err(ValidationError("Location is required."));
        }
        if (!startDatetime || !endDatetime) {
            return Err(ValidationError("Start and end datetime are required."));
        }
        if (endDatetime <= startDatetime) {
            return Err(ValidationError("End datetime must be after start datetime."));
        }
        if (capacity != null && capacity < 1) {
            return Err(ValidationError("Capacity must be at least 1."));
        }
    
        const event = eventResult.value;
        const update: IEvent = {
            ...event,
            title: title.trim(),
            description: description.trim(),
            location: location.trim(),
            category: category.trim(),
            status: status,
            startDatetime: new Date(startDatetime),
            endDatetime: new Date(endDatetime),
            capacity: capacity,
            updatedAt: new Date(),
          };
        const isUpdated = await this.eventRepository.updateEvent(eventId, update);

        if (!isUpdated.ok) {
            return Err(DatabaseError("Failed to update event."))
        }
        return Ok(isUpdated.value);
    }

    async toggleRsvp(eventId: number, userId: string, userRole: UserRole): Promise<Result<IEvent, EventError | RSVPError>> {
        const getEvent = await this.eventRepository.getEventById(eventId);
        if (!getEvent.ok) {
            return Err(EventNotFoundError(`Event ${eventId} not found.`));
        }
        const event = getEvent.value
      
        if (userRole === "admin") {
            return Err(UnauthorizedRSVPError("Only members can RSVP to events."));
        }
        
        if (event.organizerId === userId) {
            return Err(UnauthorizedRSVPError("Organizers cannot RSVP to their own events."));
        }
        if (event.status === "CANCELLED") {
            return Err(InvalidRSVPError("Cancelled events cannot receive RSVPs."));
        }

        if (event.status === "CONCLUDED") {
            return Err(InvalidRSVPError("Concluded events cannot receive RSVPs."));
        }
    
        if (event.status !== "PUBLISHED") {
            return Err(InvalidRSVPError("Only published events can receive RSVPs."));
        }

        if (new Date(event.endDatetime).getTime() <= new Date().getTime()) {
            return Err(InvalidRSVPError("Past events cannot receive RSVPs."));
        }
      
        const existing = await this.eventRepository.findUserRsvp(eventId, userId);
        let updatedRsvp: IRSVP;
        if (!existing.ok) {
            // TODO: inspect logic, this is really repetitive right now, but I can't think of
                // a much better way to do this right now
            return Err(EventNotFoundError(`Event ${eventId} not found.`));
        } 

        if (!existing.value || existing.value.rsvpStatus === "CANCELLED") {
            const status = this.nextJoinStatus(event);
      
            const res = await this.eventRepository.saveRsvp(eventId, userId, status);
            if (!res.ok) {
                return Err(DatabaseError(`Update RSVP to event ${eventId} for user ${userId} failed.`))
            }
        } else {
            // Cancel branch: delegate to the repository's atomic cancel + promote.
            // The repo method wraps the RSVP cancel and the (possibly empty) waitlist
            // promotion in one transaction (Prisma) or one synchronous mutation
            // (InMemory), so we never end up with the cancel persisted but the
            // promotion lost. It returns the refreshed event with up-to-date
            // attendees, which is exactly what callers expect.
            const cancelled = await this.eventRepository.cancelRsvpWithPromotion(
                eventId,
                userId
            );
            if (!cancelled.ok) {
                return Err(
                    DatabaseError(
                        `Cancel RSVP to event ${eventId} for user ${userId} failed.`
                    )
                );
            }
            return Ok(cancelled.value);
        }

        event.updatedAt = new Date();

        const saved = await this.eventRepository.updateEvent(event.id, event);
        if (!saved.ok) {
            return Err(ValidationError("Unable to save RSVP changes."));
        }

        return Ok(saved.value);
    }

    async getQueuePosition(
        eventId: number,
        userId: string
    ): Promise<Result<number | null, EventError>> {
        if (!eventId || eventId <= 0) {
            return Err(ValidationError("Invalid event ID."));
        }
        if (!userId) {
            return Err(ValidationError("User ID is required."));
        }

        const eventResult = await this.eventRepository.getEventById(eventId);
        if (!eventResult.ok) {
            return Err(EventNotFoundError(`Event ${eventId} not found.`));
        }

        const position = this.calculateQueuePosition(eventResult.value, userId);
        return Ok(position);
    }

    async publishEvent(eventId: number, userId: string): Promise<Result<IEvent, EventError>> {
        this.logger.info(`User ${userId} is publishing event ${eventId}`);

        const eventResult = await this.eventRepository.getEventById(eventId);

        if (!eventResult.ok) {
            return eventResult;
        }

        const event = eventResult.value;

        if (event.organizerId !== userId) {
            this.logger.info(`Publish denied for user ${userId} on event ${eventId}: not organizer`);
            return Err(UnauthorizedEventActionError("Only the organizer can publish this event"));
        } 

        if (event.status !== "DRAFT") {
            this.logger.info(`Publish denied for event ${eventId}: status is ${event.status}`);
            return Err(InvalidEventTransitionError("Only draft events can be published"));
        }

        const updatedResult = await this.eventRepository.updateEvent(eventId, {
            status: "PUBLISHED",
            updatedAt: new Date(),
        });

        if (updatedResult.ok) {
            this.logger.info(`Event ${eventId} published successfully`);
        }

        return updatedResult;
    }

    async cancelEvent(
        eventId: number,
        userId: string,
        isAdmin: boolean,
    ): Promise<Result<IEvent, EventError>> {
        this.logger.info(`User ${userId} is cancelling event ${eventId}`);

        const eventResult = await this.eventRepository.getEventById(eventId);

        if (!eventResult.ok) {
            return eventResult;
        }

        const event = eventResult.value;
        const isOrganizer = event.organizerId === userId;

        if (!isOrganizer && !isAdmin) {
            this.logger.info(`Cancel denied for user ${userId} on event ${eventId}: not organizer or admin`);
            return Err(UnauthorizedEventActionError("Only the organizer or an admin can cancel this event"));
        }

        if (event.status !== "PUBLISHED") {
            this.logger.info(`Cancel denied for event ${eventId}: status is ${event.status}`);
            return Err(InvalidEventTransitionError("Only published events can be cancelled"));
        }

        const updatedResult = await this.eventRepository.updateEvent(eventId, {
            status: "CANCELLED",
            updatedAt: new Date(),
        });

        if (updatedResult.ok) {
            this.logger.info(`Event ${eventId} cancelled successfully`);
        }

        return updatedResult;
    }

    async filterPublishedEvents(
        timeframe: string = "all",
        category: string | null = null
    ): Promise<Result<IEvent[], EventError>> {
        this.logger.info(
            `Filtering published events with timeframe "${timeframe}" and category "${category ?? "all"}"`
        );

        const allEventsResult = await this.eventRepository.getAllEvents();

        if (!allEventsResult.ok) {
            return allEventsResult;
        }

        const now = new Date();

        let filteredEvents = allEventsResult.value.filter(
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
            const weekend = this.getUpcomingWeekendRange(now);

            return Ok(
                filteredEvents.filter((event) => {
                    const start = event.startDatetime.getTime();
                    return (
                        start >= weekend.start.getTime() &&
                        start <= weekend.end.getTime()
                    );
                })
            );
        }

        return Err(InvalidEventFilterError("Invalid timeframe filter"));
    }

    async searchEvents(query: string): Promise<Result<IEvent[], EventError>> {
        // Validate input *before* normalizing so we can distinguish "user gave us
        // something we refuse to accept" from "the input is just empty/whitespace."
        //
        // Two guards:
        //   1. Runtime non-string defense. The signature is typed `string` and
        //      the /events/search route already coerces req.query.q to a string,
        //      but a direct service caller (tests, other code) could still pass
        //      something else. Reject it explicitly rather than relying on the
        //      caller to behave.
        //   2. Length cap. 200 characters is well beyond any realistic search
        //      intent and guards the server against trivially abusive inputs.
        if (typeof query !== "string") {
            return Err(InvalidSearchQueryError("Search query must be a string."));
        }
        if (query.length > 200) {
            return Err(
                InvalidSearchQueryError("Search query is too long (max 200 characters).")
            );
        }

        // Normalize once so the storage layer gets a single, predictable form.
        // The repository contract treats `query` as already trimmed + lowercased
        // and as already meaning "no text filter" when empty. This service
        // method owns the validation; the repo owns the filter.
        const normalized = query.trim().toLowerCase();
        this.logger.info(`searchEvents called with query "${normalized}"`);

        // Push the filter into the repository. The Prisma implementation
        // turns this into a single SQL query (status + endDatetime + OR of
        // contains across the four fields); the in-memory implementation
        // mirrors the same logic on the event map. Either way, we no
        // longer pull every event into the service to filter in JS.
        return this.eventRepository.searchEvents(normalized);
    }

    private getUpcomingWeekendRange(now: Date): { start: Date; end: Date } {
        const day = now.getDay(); // 0=Sun ... 6=Sat
        const daysUntilSaturday = day === 6 ? 0 : (6 - day + 7) % 7;

        const saturday = new Date(now);
        saturday.setDate(now.getDate() + daysUntilSaturday);
        saturday.setHours(0, 0, 0, 0);

        const sundayEnd = new Date(saturday);
        sundayEnd.setDate(saturday.getDate() + 1);
        sundayEnd.setHours(23, 59, 59, 999);

        return { start: saturday, end: sundayEnd };
    }
    async getDraftEventsForUser(
        userId: string,
        userRole: string
    ): Promise<Result<IEvent[], EventError>> {
        this.logger.info(`Fetching draft events for user ${userId} with role ${userRole}`);

        const allEventsResult = await this.eventRepository.getAllEvents();

        if (!allEventsResult.ok) {
            return allEventsResult;
        }

        const drafts = allEventsResult.value.filter((event) => {
            if (event.status !== "DRAFT") {
                return false;
            }

            if (userRole === "admin") {
                return true;
            }

            return event.organizerId === userId;
        });

        return Ok(drafts);
    }
    async deleteDraftEvent(
        eventId: number,
        userId: string,
        userRole: string
    ): Promise<Result<void, EventError>> {
        this.logger.info(`User ${userId} is deleting draft event ${eventId}`);

        const eventResult = await this.eventRepository.getEventById(eventId);
        if (!eventResult.ok) {
            return Err(eventResult.value as EventError);
        }

        const event = eventResult.value;
        const isAdmin = userRole === "admin";
        const isOrganizer = event.organizerId === userId;

        if (!isAdmin && !isOrganizer) {
            return Err(UnauthorizedEventActionError("Only the organizer or an admin can delete this draft event"));
        }

        if (event.status !== "DRAFT") {
            return Err(InvalidEventTransitionError("Only draft events can be deleted"));
        }

        return await this.eventRepository.deleteEvent(eventId);
    }


}

export function createEventService(eventRepository: IEventRepository, logger: ILoggingService): IEventService {
    return new EventService(eventRepository, logger);
}