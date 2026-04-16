import { EventError, EventNotFoundError, ValidationError } from "../lib/errors";
import { Err, Result } from "../lib/result";
import { IEventRepository } from "../repository/EventRepository";
import { IEvent } from "../types/EventTypes";
import { ILoggingService } from "./LoggingService";



export interface IEventService {
    publishEvent(eventId: string, userId: string): Promise<Result<IEvent, EventError>>;
    cancelEvent(eventId: string, userId: string, isAdmin: boolean): Promise<Result<IEvent, EventError>>;
    createEvent(organizerId: string, eventName: string, eventDesc: string, location: string, datetime: Date, capacity: number): Promise<Result<IEvent, EventError>>;
    getEventDetails(eventId: string): Promise<Result<IEvent, EventError>>;
}

class EventService implements IEventService {
    constructor(private readonly eventRepository: IEventRepository, private readonly logger: ILoggingService) {}
    
    async publishEvent(eventId: string, userId: string): Promise<Result<IEvent, EventError>> {
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
        eventId: string,
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


    async createEvent(organizerId: string, eventName: string, eventDesc: string, location: string, datetime: Date, capacity: number): Promise<Result<IEvent, EventError>> {
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
    }

    async getEventDetails(eventId: string): Promise<Result<IEvent, EventError>> {
        return Promise.resolve({ ok: false, value: EventNotFoundError("Not implemented") });
    }
}

export function createEventService(eventRepository: IEventRepository, logger: ILoggingService): IEventService {
    return new EventService(eventRepository, logger);
}