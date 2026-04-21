import { permission } from "node:process";
import { AuthError, AuthorizationRequired } from "../auth/errors";
import {
    EventError,
    EventNotFoundError,
    InvalidEventTransitionError,
    UnauthorizedEventActionError,
    UnknownError,
    ValidationError
} from "../lib/errors";
import { IAuthenticatedUserSession } from "../session/AppSession";
import { Err, Ok, Result } from "../lib/result";
import { IEventRepository } from "../repository/EventRepository";
import { CreateEventData, IEvent, IRSVP, RSVPStatus } from "../types/EventTypes";
import { ILoggingService } from "./LoggingService";
import { UserRole } from "../auth/User";



export interface IEventService {
    createEvent(eventData: CreateEventData): Promise<Result<IEvent, EventError>>;
    getEventDetails(eventId: number): Promise<Result<IEvent, EventError>>;
    getEventEditForm(eventId: number, userId: String, userRole: string): Promise<Result<IEvent, EventError | AuthError>>;
    updateEvent(eventId: number, 
        userId: string,
        userRole: string,
        title: string,
        description: string,
        location: string,
        startDatetime: Date,
        endDatetime: Date,
        capacity: number): Promise<Result<IEvent, EventError>>;
    toggleRsvp(eventId: number, userId: string, userRole: UserRole): Promise<Result<IEvent, EventError>>;
    publishEvent(eventId: number, userId: string): Promise<Result<IEvent, EventError>>;
    cancelEvent(eventId: number, userId: string, isAdmin: boolean): Promise<Result<IEvent, EventError>>;
    filterPublishedEvents(timeframe?: string, category?: string | null): Promise<Result<IEvent[], EventError>>;
    /**
     * Returns the 1-based position of the given user in the waitlist for the event,
     * or null if the user is not currently waitlisted. Position is ordered by
     * createdAt (earliest join is #1).
     */
    getQueuePosition(eventId: number, userId: string): Promise<Result<number | null, EventError>>;
}

class EventService implements IEventService {
    constructor(private readonly eventRepository: IEventRepository, private readonly logger: ILoggingService) {}

    private canEditEvent(event: IEvent, userId: string, userRole: string): Result<null, EventError | AuthError> {
        const isAdmin = userRole=== "admin";
        const isOwner = event.organizerId === userId;
    
        if (userRole === "user" && !isOwner) {
            return Err(AuthorizationRequired("Only owner can edit events."));
        }
    
        if (!isAdmin && !isOwner) {
            return Err(AuthorizationRequired("Need permission to edit this event."));
        }
    
        const now = new Date();
        if (event.status === "CANCELLED" || event.status === "CONCLUDED") {
            return Err(ValidationError("Cancelled or concluded events cannot be edited."));
        }
    
        if (event.endDatetime.getTime() < now.getTime()) {
            return Err(ValidationError("Past events cannot be edited."));
        }
    
        return Ok(null);
    }

    private canRsvp(event: IEvent, userId: string, userRole: UserRole): Result<void, EventError> {
        if (userRole === "admin") {
            // TODO: rsvp error logic
            return Err(UnknownError("Only members can RSVP to events."));
        }

        if (event.organizerId === userId) {
            // TODO: rsvp error logic
            return Err(UnknownError("Organizers cannot RSVP to their own events."));
        }

        if (event.status === "CANCELLED") {
            // TODO: rsvp error logic
            return Err(UnknownError("Cancelled events cannot receive RSVPs."));
        }

        if (event.status === "CONCLUDED") {
            // TODO: rsvp error logic
            return Err(UnknownError("Concluded events cannot receive RSVPs."));
        }
    
        if (event.status !== "PUBLISHED") {
            // TODO: rsvp error logic
            return Err(UnknownError("Only published events can receive RSVPs."));
        }

        if (new Date(event.endDatetime).getTime() <= new Date().getTime()) {
            // TODO: rsvp error logic
            return Err(UnknownError("Past events cannot receive RSVPs."));
        }
    
        return Ok(undefined);
    }

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

      /**
       * Promotes the earliest waitlisted RSVP to GOING if there is capacity.
       * Mutates the passed event in-place; the caller is responsible for
       * persisting the event in the same repository write so the cancel
       * and promotion land atomically.
       */
      private promoteWaitlistedIfPossible(event: IEvent): IRSVP | null {
        if (event.capacity === null) {
          return null;
        }

        const goingCount = this.countGoing(event.attendees);
        if (goingCount >= event.capacity) {
          return null;
        }

        const waitlisted = this.orderedWaitlist(event)[0];
        if (!waitlisted) {
          return null;
        }

        waitlisted.rsvpStatus = "GOING";
        this.logger.info(
          `Promoted user ${waitlisted.userId} from waitlist to GOING on event ${event.id}`
        );
        return waitlisted;
      }

    async createEvent(eventData: CreateEventData): Promise<Result<IEvent, EventError>> {
        // 1. Validate input data
        const title = String(eventData.title ?? "").trim();
        const description = String(eventData.description ?? "").trim();
        const location = String(eventData.location ?? "").trim();
        const { organizerId, startDatetime, endDatetime, capacity, status, attendees, category } = eventData;

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
        if (!organizerId) {
            return Err(ValidationError("Organizer is required."));
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

    async getEventEditForm(eventId: number, userId: string, userRole: string): Promise<Result<IEvent, EventError | AuthError>> {
        const event = await this.eventRepository.getEventById(eventId);

        if (event.ok) {
            const permissionCheck = this.canEditEvent(event.value, userId, userRole);
            if (permissionCheck.ok) {
                return Ok(event.value);
            } else return permissionCheck;
        } else {
            return Err(EventNotFoundError(`Event ${eventId} not found.`));
        }
    }

    async updateEvent(eventId: number, userId: string, userRole: string, title: string, description: string, location: string, startDatetime: Date, endDatetime: Date, capacity: number): Promise<Result<IEvent, EventError>> {
        const eventResult = await this.getEventEditForm(eventId, userId, userRole);
        if (!eventResult.ok) {
            // TODO: verify error
          return Err(ValidationError("Cannot edit event."));
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
            startDatetime: startDatetime!,
            endDatetime: endDatetime!,
            capacity: capacity,
            updatedAt: new Date(),
          };
        const isUpdated = await this.eventRepository.updateEvent(eventId, update);
        if (!isUpdated) {
          return Err(EventNotFoundError("Event not found."));
        } 

        if (!isUpdated.ok) {
            // Verify this is the correct error type
            return Err(ValidationError("Failed to update event."))
        }
        return Ok(isUpdated.value);
    }

    async toggleRsvp(eventId: number, userId: string, userRole: UserRole): Promise<Result<IEvent, EventError>> {
        const getEvent = await this.eventRepository.getEventById(eventId);
        if (!getEvent.ok) {
            return Err(EventNotFoundError(`Event ${eventId} not found.`));
        }
        const event = getEvent.value
        const now = new Date();
      
        const allowed = this.canRsvp(event, userId, userRole);
        if (!allowed.ok) {
            // TODO: rsvp error logic
            return Err(UnknownError("TODO"));
        }
      
        const existing = await this.eventRepository.findUserRsvp(eventId, userId);
        let updatedRsvp: IRSVP;
        if (!existing.ok) {
            const status = this.nextJoinStatus(event);
      
            updatedRsvp = {
                id: `rsvp_${eventId}_${userId}_${Date.now().toString(36)}`,
                eventId,
                userId,
                rsvpStatus: status,
                createdAt: new Date(),
            };
      
            event.attendees.push(updatedRsvp);
        } else if (existing.value.rsvpStatus === "CANCELLED") {
            const status = this.nextJoinStatus(event);
            updatedRsvp = {
                ...existing.value,
                rsvpStatus: status,
            };

            const idx = event.attendees.findIndex(
                (r) => r.eventId === eventId && r.userId === userId
            );

            if (idx >= 0) {
                event.attendees[idx] = updatedRsvp;
            } else {
                event.attendees.push(updatedRsvp);
            }
        } else {
            const wasGoing = existing.value.rsvpStatus === "GOING";

            updatedRsvp = {
                ...existing.value,
                rsvpStatus: "CANCELLED",
            };

            const idx = event.attendees.findIndex(
                (r) => r.eventId === eventId && r.userId === userId
            );

            if (idx >= 0) {
                event.attendees[idx] = updatedRsvp;
            } else {
                event.attendees.push(updatedRsvp);
            }

            if (wasGoing) {
                this.promoteWaitlistedIfPossible(event);
            }
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

        return Err(ValidationError("Invalid timeframe filter"));
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


}

export function createEventService(eventRepository: IEventRepository, logger: ILoggingService): IEventService {
    return new EventService(eventRepository, logger);
}