import { EventError, EventNotFoundError } from "../lib/errors";
import { Result } from "../lib/result";
import { IEventRepository } from "../repository/EventRepository";
import { IAuthenticatedUserSession } from "../session/AppSession";
import { IEvent } from "../types/EventTypes";
import { ILoggingService } from "./LoggingService";

export interface IEventService {
    createEvent(organizerId: string, eventName: string, eventDesc: string, location: string, datetime: Date, capacity: number): Promise<Result<IEvent, EventError>>;
    getEventDetails(eventId: string): Promise<Result<IEvent, EventError>>;
    getEventEditForm(eventId: number, user: IAuthenticatedUserSession): Promise<Result<IEvent, EventError>>;
    updateEvent(eventId: number, 
        user: IAuthenticatedUserSession, 
        title: string,
        description: string,
        location: string,
        startDatetime: Date,
        endDatetime: Date,
        capacity: number): Promise<Result<IEvent, EventError>>;
}

class EventService implements IEventService {
    constructor(private readonly eventRepository: IEventRepository, private readonly logger: ILoggingService) {}

    async createEvent(organizerId: string, eventName: string, eventDesc: string, location: string, datetime: Date, capacity: number): Promise<Result<IEvent, EventError>> {
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
    }

    async getEventDetails(eventId: string): Promise<Result<IEvent, EventError>> {
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
    }

    async getEventEditForm(eventId: number, user: IAuthenticatedUserSession): Promise<Result<IEvent, EventError>> {
        // TODO
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
    }

    async updateEvent(eventId: number, user: IAuthenticatedUserSession, title: string, description: string, location: string, startDatetime: Date, endDatetime: Date, capacity: number): Promise<Result<IEvent, EventError>> {
        // TODO
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
    }
}

export function createEventService(eventRepository: IEventRepository, logger: ILoggingService): IEventService {
    return new EventService(eventRepository, logger);
}