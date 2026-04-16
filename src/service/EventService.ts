import { permission } from "node:process";
import { AuthorizationRequired, ValidationError } from "../auth/errors";
import { EventError, EventNotFoundError } from "../lib/errors";
import { Err, Ok, Result } from "../lib/result";
import { IEventRepository } from "../repository/EventRepository";
import { IAuthenticatedUserSession } from "../session/AppSession";
import { IEvent } from "../types/EventTypes";
import { ILoggingService } from "./LoggingService";

export interface IEventService {
    createEvent(organizerId: string, eventName: string, eventDesc: string, location: string, datetime: Date, capacity: number): Promise<Result<IEvent, EventError>>;
    getEventDetails(eventId: number): Promise<Result<IEvent, EventError>>;
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

    private canEditEvent(event: IEvent, user: IAuthenticatedUserSession): Result<void> {
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
    
        return Ok(undefined);
    }

    async createEvent(organizerId: string, eventName: string, eventDesc: string, location: string, datetime: Date, capacity: number): Promise<Result<IEvent, EventError>> {
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
    }

    async getEventDetails(eventId: number): Promise<Result<IEvent, EventError>> {
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
    }

    async getEventEditForm(eventId: number, user: IAuthenticatedUserSession): Promise<Result<IEvent, EventError>> {
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
        // TODO
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
    }
}

export function createEventService(eventRepository: IEventRepository, logger: ILoggingService): IEventService {
    return new EventService(eventRepository, logger);
}