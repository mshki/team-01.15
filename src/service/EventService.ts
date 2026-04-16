import { permission } from "node:process";
import { AuthError, AuthorizationRequired } from "../auth/errors";
import { EventError, EventNotFoundError, ValidationError } from "../lib/errors";
import { IAuthenticatedUserSession } from "../session/AppSession";
import { Err, Ok, Result } from "../lib/result";
import { IEventRepository } from "../repository/EventRepository";
import { CreateEventData, IEvent, IRSVP } from "../types/EventTypes";
import { ILoggingService } from "./LoggingService";



export interface IEventService {
    createEvent(eventData: CreateEventData): Promise<Result<IEvent, EventError>>;
    getEventDetails(eventId: number): Promise<Result<IEvent, EventError>>;
    getEventEditForm(eventId: number, user: IAuthenticatedUserSession): Promise<Result<IEvent, EventError | AuthError>>;
    updateEvent(eventId: number, 
        user: IAuthenticatedUserSession, 
        title: string,
        description: string,
        location: string,
        startDatetime: Date,
        endDatetime: Date,
        capacity: number): Promise<Result<IEvent, EventError>>;
    toggleRsvp(eventId: number, userId: string): Promise<Result<IRSVP, EventError>>;
    publishEvent(eventId: number, userId: string): Promise<Result<IEvent, EventError>>;
    cancelEvent(eventId: number, userId: string, isAdmin: boolean): Promise<Result<IEvent, EventError>>;
}

class EventService implements IEventService {
    constructor(private readonly eventRepository: IEventRepository, private readonly logger: ILoggingService) {}

    private canEditEvent(event: IEvent, user: IAuthenticatedUserSession): Result<null, EventError | AuthError> {
        const isAdmin = user.role === "admin";
        const isOwner = event.organizerId === user.userId;
    
        if (user.role === "user" && !isOwner) {
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

    async createEvent(eventData: CreateEventData): Promise<Result<IEvent, EventError>> {
        // 1. Validate input data
        const title = String(eventData.title ?? "").trim();
        const description = String(eventData.description ?? "").trim();
        const location = String(eventData.location ?? "").trim();
        const { organizerId, startDatetime, endDatetime, capacity, status, attendees } = eventData;

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
        const result = await this.eventRepository.createEvent({ title, description, location, organizerId, startDatetime, endDatetime, capacity, status, attendees });
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
            if (result.value.name === "EventNotFoundError") {
                return Err(EventNotFoundError(`Event with ID ${eventId} not found.`));
            }
            return Err(result.value);
        }

        // 3. Handle repository result and return appropriate response
        return Ok(result.value);
    }

    async getEventEditForm(eventId: number, user: IAuthenticatedUserSession): Promise<Result<IEvent, EventError | AuthError>> {
        const event = await this.eventRepository.getEventById(eventId);

        if (event.ok) {
            const permissionCheck = this.canEditEvent(event.value, user);
            if (permissionCheck.ok) {
                return Ok(event.value);
            } else return permissionCheck;
        } else {
            return Err(EventNotFoundError(`Event ${eventId} not found.`));
        }
    }

    async updateEvent(eventId: number, user: IAuthenticatedUserSession, title: string, description: string, location: string, startDatetime: Date, endDatetime: Date, capacity: number): Promise<Result<IEvent, EventError>> {
        const eventResult = await this.getEventEditForm(eventId, user);
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

    async toggleRsvp(eventId: number, userId: string): Promise<Result<IRSVP, EventError>> {
        // TODO
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
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
            return Err(ValidationError("Only the organizer can publish this event"));
        }

        if (event.status !== "DRAFT") {
            this.logger.info(`Publish denied for event ${eventId}: status is ${event.status}`);
            return Err(ValidationError("Only draft events can be published"));
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
            return Err(ValidationError("Only the organizer or an admin can cancel this event"));
        }

        if (event.status !== "PUBLISHED") {
            this.logger.info(`Cancel denied for event ${eventId}: status is ${event.status}`);
            return Err(ValidationError("Only published events can be cancelled"));
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

}

export function createEventService(eventRepository: IEventRepository, logger: ILoggingService): IEventService {
    return new EventService(eventRepository, logger);
}