import { EventError, EventNotFoundError, ValidationError } from "../lib/errors";
import { Err, Result } from "../lib/result";
import { IEventRepository } from "../repository/EventRepository";
import { CreateEventData, IEvent } from "../types/EventTypes";
import { ILoggingService } from "./LoggingService";

export interface IEventService {
    createEvent(eventData: CreateEventData): Promise<Result<IEvent, EventError>>;
    getEventDetails(eventId: number): Promise<Result<IEvent, EventError>>;
    getEventEditForm(eventId: number, userId: string): Promise<Result<IEvent, EventError>>;
    updateEvent(eventId: number, 
        userId: string, 
        title: string,
        description: string,
        location: string,
        startDatetime: Date,
        endDatetime: Date,
        capacity: number): Promise<Result<IEvent, EventError>>;
}

class EventService implements IEventService {
    constructor(private readonly eventRepository: IEventRepository, private readonly logger: ILoggingService) {}

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
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
    }

    async getEventEditForm(eventId: number, userId: string): Promise<Result<IEvent, EventError>> {
        // TODO
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
    }

    async updateEvent(eventId: number, userId: string, title: string, description: string, location: string, startDatetime: Date, endDatetime: Date, capacity: number): Promise<Result<IEvent, EventError>> {
        // TODO
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
    }
}

export function createEventService(eventRepository: IEventRepository, logger: ILoggingService): IEventService {
    return new EventService(eventRepository, logger);
}