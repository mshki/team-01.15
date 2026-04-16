import { EventError, EventNotFoundError } from "../lib/errors";
import { Result } from "../lib/result";
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
        // TODO:

        // 1. Validate input data (e.g. check required fields, validate datetime formats, etc.)
        // 2. Call repository to create event
        // 3. Handle repository result and return appropriate response

        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
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